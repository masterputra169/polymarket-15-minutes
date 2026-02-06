import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../config.js';
import { fetchKlines, fetchLastPrice } from '../data/binance.js';
import { fetchPolymarketSnapshot } from '../data/polymarket.js';
import { fetchChainlinkBtcUsd } from '../data/chainlinkRpc.js';
import { computeSessionVwap, computeVwapSeries } from '../indicators/vwap.js';
import { computeRsi, computeRsiSeries, sma, slopeLast } from '../indicators/rsi.js';
import { computeMacd } from '../indicators/macd.js';
import { computeHeikenAshi, countConsecutive } from '../indicators/heikenAshi.js';
import { detectRegime } from '../engines/regime.js';
import { scoreDirection, applyTimeAwareness } from '../engines/probability.js';
import { computeEdge, decide } from '../engines/edge.js';
import {
  getCandleWindowTiming,
  narrativeFromSign,
  narrativeFromSlope,
  extractPriceToBeat,
} from '../utils.js';

function countVwapCrosses(closes, vwapSeries, lookback) {
  if (closes.length < lookback || vwapSeries.length < lookback) return null;
  let crosses = 0;
  for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] - vwapSeries[i - 1];
    const cur = closes[i] - vwapSeries[i];
    if (prev === 0) continue;
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
  }
  return crosses;
}

export function useMarketData({ clobWs } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);
  const priceToBeatRef = useRef({ slug: null, value: null });
  const tokenIdsNotifiedRef = useRef(false);

  // Cache polymarket snapshot
  const polySnapshotRef = useRef(null);
  const polyLastFetchRef = useRef(0);

  // ═══ NEW: Track current market for expiry detection ═══
  const currentMarketEndMsRef = useRef(null);
  const currentMarketSlugRef = useRef(null);

  // Prevent concurrent polls
  const pollingRef = useRef(false);

  // ═══ NEW: Force invalidate all market cache ═══
  const invalidateMarketCache = useCallback(() => {
    polySnapshotRef.current = null;
    polyLastFetchRef.current = 0;
    tokenIdsNotifiedRef.current = false;
    currentMarketEndMsRef.current = null;
    priceToBeatRef.current = { slug: null, value: null };
    // Allow PTB debug log for new market
    window.__ptbLogged = false;
  }, []);

  const poll = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;

    try {
      const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
      const now = Date.now();
      const wsConnected = clobWs?.connected ?? false;

      // ═══ NEW: Detect if current market has EXPIRED ═══
      const marketExpired =
        currentMarketEndMsRef.current !== null &&
        now >= currentMarketEndMsRef.current;

      if (marketExpired) {
        console.log('[Market] ⏰ Current market expired! Forcing fresh discovery...');
        invalidateMarketCache();
      }

      // 1. Always fetch klines + last price (needed for TA)
      let klines1m, lastPrice;
      try {
        [klines1m, lastPrice] = await Promise.all([
          fetchKlines({ interval: '1m', limit: 240 }),
          fetchLastPrice(),
        ]);
      } catch (err) {
        throw new Error(`Binance: ${err.message}`);
      }

      // 2. Polymarket: fetch when needed
      const marketDiscoveryInterval = CONFIG.marketDiscoveryIntervalMs || 5_000;
      let poly;
      const needsFreshPoly =
        !polySnapshotRef.current ||
        now - polyLastFetchRef.current > marketDiscoveryInterval ||
        marketExpired;

      if (needsFreshPoly) {
        // ═══ FIX: Don't skip CLOB right after market switch ═══
        const skipClob = wsConnected && !marketExpired;
        poly = await fetchPolymarketSnapshot({ skipClob });
        polySnapshotRef.current = poly;
        polyLastFetchRef.current = now;

        // ═══ NEW: Track market end time for expiry detection ═══
        if (poly.ok && poly.market?.endDate) {
          const endMs = new Date(poly.market.endDate).getTime();
          if (Number.isFinite(endMs)) {
            currentMarketEndMsRef.current = endMs;
          }
        }
      } else {
        poly = polySnapshotRef.current;
      }

      // 3. Chainlink RPC (internally cached)
      let chainlinkRpc = { price: null, updatedAt: null, source: 'chainlink_rpc_skipped' };
      try {
        chainlinkRpc = await fetchChainlinkBtcUsd();
      } catch {
        // Silently fail
      }

      // ═══ Market slug tracking & switch detection ═══
      const marketSlug = poly.ok ? String(poly.market?.slug ?? '') : '';
      const slugChanged =
        marketSlug !== '' &&
        currentMarketSlugRef.current !== null &&
        currentMarketSlugRef.current !== marketSlug;

      // ═══ NEW: Handle market switch properly ═══
      if (slugChanged) {
        console.log(`[Market] 🔄 Switched: "${currentMarketSlugRef.current}" → "${marketSlug}"`);

        // Reset for new market
        tokenIdsNotifiedRef.current = false;
        priceToBeatRef.current = { slug: null, value: null };
        window.__ptbLogged = false;

        // Re-subscribe CLOB WS to new market tokens immediately
        if (poly.ok && poly.tokens && clobWs?.setTokenIds) {
          console.log('[Market] 📡 Re-subscribing CLOB WS to new tokens...');
          clobWs.setTokenIds(poly.tokens.upTokenId, poly.tokens.downTokenId);
          tokenIdsNotifiedRef.current = true;
        }

        // Force fresh fetch next cycle (get CLOB prices for new market)
        polySnapshotRef.current = null;
      }

      // Update slug tracker
      if (marketSlug) {
        currentMarketSlugRef.current = marketSlug;
      }

      // Notify CLOB WS of token IDs (first time or after reset)
      if (
        poly.ok &&
        poly.tokens &&
        clobWs?.setTokenIds &&
        !tokenIdsNotifiedRef.current
      ) {
        clobWs.setTokenIds(poly.tokens.upTokenId, poly.tokens.downTokenId);
        tokenIdsNotifiedRef.current = true;
      }

      // ── TA Calculations ──
      const candles = klines1m;
      const closes = candles.map((c) => c.close);

      // VWAP (using shorter lookback — 60 candles = 1 hour, not 240 = 4 hours)
      const vwapSeries = computeVwapSeries(candles, CONFIG.vwapLookbackCandles);
      const vwapNow = vwapSeries[vwapSeries.length - 1];
      const lookback = CONFIG.vwapSlopeLookbackMinutes;
      const vwapSlope =
        vwapSeries.length >= lookback
          ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback
          : null;
      const vwapDist = vwapNow ? (lastPrice - vwapNow) / vwapNow : null;

      // RSI (using faster period 8 for 15-min responsiveness)
      const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
      const rsiSeries = computeRsiSeries(closes, CONFIG.rsiPeriod);
      const rsiSlope = slopeLast(rsiSeries, 3);

      // MACD (faster 6/13/5 for 15-min windows)
      const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

      // Heiken Ashi
      const ha = computeHeikenAshi(candles);
      const consec = countConsecutive(ha);

      // Regime
      const vwapCrossCount = countVwapCrosses(closes, vwapSeries, 20);
      const volumeRecent = candles.slice(-20).reduce((a, c) => a + c.volume, 0);
      const volumeAvg = candles.slice(-120).reduce((a, c) => a + c.volume, 0) / 6;

      const failedVwapReclaim =
        vwapNow !== null && vwapSeries.length >= 3
          ? closes[closes.length - 1] < vwapNow &&
            closes[closes.length - 2] > vwapSeries[vwapSeries.length - 2]
          : false;

      const regimeInfo = detectRegime({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        vwapCrossCount,
        volumeRecent,
        volumeAvg,
      });

      // ═══ REWORKED: Deltas computed BEFORE scoring (needed as input) ═══
      const lastClose = closes[closes.length - 1] ?? null;
      const close1mAgo = closes.length >= 2 ? closes[closes.length - 2] : null;
      const close3mAgo = closes.length >= 4 ? closes[closes.length - 4] : null;
      const delta1m = lastClose !== null && close1mAgo !== null ? lastClose - close1mAgo : null;
      const delta3m = lastClose !== null && close3mAgo !== null ? lastClose - close3mAgo : null;

      // ═══ Price to Beat (needed for scoring) ═══
      const marketQuestion = poly.ok ? (poly.market?.question ?? poly.market?.title ?? '') : '';
      const priceToBeat = poly.ok
        ? extractPriceToBeat(poly.market, klines1m)
        : null;

      if (marketSlug && priceToBeatRef.current.slug !== marketSlug) {
        priceToBeatRef.current = { slug: marketSlug, value: priceToBeat };
      } else if (priceToBeat !== null) {
        priceToBeatRef.current.value = priceToBeat;
      }

      // Probability — REWORKED: passes PTB distance + momentum + regime as signals
      const scored = scoreDirection({
        price: lastPrice,
        priceToBeat: priceToBeatRef.current.value,
        vwap: vwapNow,
        vwapSlope,
        rsi: rsiNow,
        rsiSlope,
        macd,
        heikenColor: consec.color,
        heikenCount: consec.count,
        failedVwapReclaim,
        delta1m,
        delta3m,
        regime: regimeInfo,
      });

      // Settlement timing
      const settlementMs =
        poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
      const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;
      const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;

      const timeAware = applyTimeAwareness(
        scored.rawUp,
        timeLeftMin,
        CONFIG.candleWindowMinutes,
      );

      // ═══ CLOB Prices ═══
      const wsUpPrice = clobWs?.upPrice;
      const wsDownPrice = clobWs?.downPrice;

      // ═══ NEW: Don't use stale WS prices right after market switch ═══
      const wsDataFresh = wsConnected && !slugChanged;

      const marketUp =
        wsDataFresh && wsUpPrice !== null
          ? wsUpPrice
          : poly.ok
            ? poly.prices.up
            : null;
      const marketDown =
        wsDataFresh && wsDownPrice !== null
          ? wsDownPrice
          : poly.ok
            ? poly.prices.down
            : null;

      // Orderbook
      const wsOrderbook = clobWs?.orderbook;
      const orderbookUp =
        wsDataFresh && wsOrderbook?.up?.bestBid !== null
          ? wsOrderbook.up
          : poly.ok
            ? poly.orderbook?.up
            : null;
      const orderbookDown =
        wsDataFresh && wsOrderbook?.down?.bestBid !== null
          ? wsOrderbook.down
          : poly.ok
            ? poly.orderbook?.down
            : null;

      // Edge
      const edge = computeEdge({
        modelUp: timeAware.adjustedUp,
        modelDown: timeAware.adjustedDown,
        marketYes: marketUp,
        marketNo: marketDown,
      });
      const rec = decide({
        remainingMinutes: timeLeftMin,
        edgeUp: edge.edgeUp,
        edgeDown: edge.edgeDown,
        modelUp: timeAware.adjustedUp,
        modelDown: timeAware.adjustedDown,
      });


      // MACD label
      const macdLabel =
        macd === null
          ? '-'
          : macd.hist < 0
            ? macd.histDelta !== null && macd.histDelta < 0
              ? 'Bearish (expanding)'
              : 'Bearish'
            : macd.histDelta !== null && macd.histDelta > 0
              ? 'Bullish (expanding)'
              : 'Bullish';

      // Narratives
      const haNarrative =
        (consec.color ?? '').toLowerCase() === 'green'
          ? 'LONG'
          : (consec.color ?? '').toLowerCase() === 'red'
            ? 'SHORT'
            : 'NEUTRAL';
      const rsiNarrative = narrativeFromSlope(rsiSlope);
      const macdNarrative = narrativeFromSign(macd?.hist ?? null);
      const vwapNarrative = narrativeFromSign(vwapDist);

      const vwapSlopeLabel =
        vwapSlope === null ? '-' : vwapSlope > 0 ? 'UP' : vwapSlope < 0 ? 'DOWN' : 'FLAT';


      // ═══ DEBUG: Log market fields for Price to Beat discovery ═══
      if (poly.ok && poly.market && !window.__ptbLogged) {
        console.log('[PTB Debug] Market keys:', Object.keys(poly.market));
        console.log('[PTB Debug] question:', poly.market.question);
        console.log('[PTB Debug] title:', poly.market.title);
        console.log('[PTB Debug] description:', poly.market.description?.slice(0, 300));
        console.log('[PTB Debug] slug:', poly.market.slug);
        console.log('[PTB Debug] groupItemTitle:', poly.market.groupItemTitle);
        console.log('[PTB Debug] startDate:', poly.market.startDate);
        console.log('[PTB Debug] eventStartTime:', poly.market.eventStartTime);
        console.log('[PTB Debug] endDate:', poly.market.endDate);
        console.log('[PTB Debug] Extracted priceToBeat:', priceToBeat);
        // Log all numeric/short string fields
        for (const [k, v] of Object.entries(poly.market)) {
          if (typeof v === 'number' || (typeof v === 'string' && !isNaN(v) && v.length < 20 && v !== '')) {
            console.log(`[PTB Debug] ${k}:`, v);
          }
        }
        window.__ptbLogged = true;
      }

      // Liquidity
      const liquidity = poly.ok
        ? Number(poly.market?.liquidityNum) || Number(poly.market?.liquidity) || null
        : null;

      setData({
        lastPrice,
        chainlinkRpc,
        poly,
        marketUp,
        marketDown,
        marketSlug,
        liquidity,
        settlementLeftMin,
        orderbookUp,
        orderbookDown,
        clobSource: wsDataFresh && wsUpPrice !== null ? 'WebSocket' : 'REST',
        clobWsConnected: wsConnected,
        priceToBeat: priceToBeatRef.current.value,
        marketQuestion,
        vwapNow,
        vwapDist,
        vwapSlope,
        vwapSlopeLabel,
        rsiNow,
        rsiSlope,
        macd,
        macdLabel,
        consec,
        delta1m,
        delta3m,
        lastClose,
        haNarrative,
        rsiNarrative,
        macdNarrative,
        vwapNarrative,
        pLong: timeAware.adjustedUp,
        pShort: timeAware.adjustedDown,
        rawUp: scored.rawUp,
        rawDown: scored.rawDown,
        scoreBreakdown: scored.breakdown,
        timeDecay: timeAware.timeDecay,
        regimeInfo,
        edge,
        rec,
        timeLeftMin,
        timing,
      });

      setLastUpdated(Date.now());
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    } finally {
      pollingRef.current = false;
    }
  }, [clobWs, invalidateMarketCache]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, CONFIG.pollIntervalMs);
    return () => clearInterval(intervalRef.current);
  }, [poll]);

  return { data, loading, error, lastUpdated };
}