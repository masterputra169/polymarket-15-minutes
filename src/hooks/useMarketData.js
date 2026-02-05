import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../config.js';
import { fetchKlines, fetchLastPrice } from '../data/binance.js';
import { fetchPolymarketSnapshot } from '../data/polymarket.js';
import { fetchChainlinkBtcUsd } from '../data/chainlinkRpc.js';
import { computeSessionVwap, computeVwapSeries } from '../indicators/vwap.js';
import { computeRsi, sma, slopeLast } from '../indicators/rsi.js';
import { computeMacd } from '../indicators/macd.js';
import { computeHeikenAshi, countConsecutive } from '../indicators/heikenAshi.js';
import { detectRegime } from '../engines/regime.js';
import { scoreDirection, applyTimeAwareness } from '../engines/probability.js';
import { computeEdge, decide } from '../engines/edge.js';
import {
  getCandleWindowTiming,
  narrativeFromSign,
  narrativeFromSlope,
  formatPct,
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

export function useMarketData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);
  const priceToBeatRef = useRef({ slug: null, value: null });

  const poll = useCallback(async () => {
    try {
      const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

      const [klines1m, lastPrice, poly, chainlinkRpc] = await Promise.all([
        fetchKlines({ interval: '1m', limit: 240 }),
        fetchLastPrice(),
        fetchPolymarketSnapshot(),
        fetchChainlinkBtcUsd(),
      ]);

      const candles = klines1m;
      const closes = candles.map((c) => c.close);

      // VWAP
      const vwapSeries = computeVwapSeries(candles);
      const vwapNow = vwapSeries[vwapSeries.length - 1];
      const lookback = CONFIG.vwapSlopeLookbackMinutes;
      const vwapSlope =
        vwapSeries.length >= lookback
          ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback
          : null;
      const vwapDist = vwapNow ? (lastPrice - vwapNow) / vwapNow : null;

      // RSI
      const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
      const rsiSeries = [];
      for (let i = 0; i < closes.length; i += 1) {
        const sub = closes.slice(0, i + 1);
        const r = computeRsi(sub, CONFIG.rsiPeriod);
        if (r !== null) rsiSeries.push(r);
      }
      const rsiSlope = slopeLast(rsiSeries, 3);

      // MACD
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

      // Probability scoring
      const scored = scoreDirection({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        rsi: rsiNow,
        rsiSlope,
        macd,
        heikenColor: consec.color,
        heikenCount: consec.count,
        failedVwapReclaim,
      });

      // Settlement timing
      const settlementMs =
        poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
      const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;
      const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;

      const timeAware = applyTimeAwareness(
        scored.rawUp,
        timeLeftMin,
        CONFIG.candleWindowMinutes
      );

      // Edge
      const marketUp = poly.ok ? poly.prices.up : null;
      const marketDown = poly.ok ? poly.prices.down : null;
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

      // Deltas
      const lastClose = closes[closes.length - 1] ?? null;
      const close1mAgo = closes.length >= 2 ? closes[closes.length - 2] : null;
      const close3mAgo = closes.length >= 4 ? closes[closes.length - 4] : null;
      const delta1m = lastClose !== null && close1mAgo !== null ? lastClose - close1mAgo : null;
      const delta3m = lastClose !== null && close3mAgo !== null ? lastClose - close3mAgo : null;

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

      // Price to beat
      const marketSlug = poly.ok ? String(poly.market?.slug ?? '') : '';
      if (marketSlug && priceToBeatRef.current.slug !== marketSlug) {
        priceToBeatRef.current = { slug: marketSlug, value: null };
      }

      // Liquidity
      const liquidity = poly.ok
        ? Number(poly.market?.liquidityNum) || Number(poly.market?.liquidity) || null
        : null;

      setData({
        // Prices
        lastPrice,
        chainlinkRpc,
        // Polymarket
        poly,
        marketUp,
        marketDown,
        marketSlug,
        liquidity,
        settlementLeftMin,
        // TA
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
        // Narratives
        haNarrative,
        rsiNarrative,
        macdNarrative,
        vwapNarrative,
        // Probability
        pLong: timeAware.adjustedUp,
        pShort: timeAware.adjustedDown,
        timeDecay: timeAware.timeDecay,
        // Regime & Edge
        regimeInfo,
        edge,
        rec,
        // Timing
        timeLeftMin,
        timing,
      });

      setLastUpdated(Date.now());
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, CONFIG.pollIntervalMs);
    return () => clearInterval(intervalRef.current);
  }, [poll]);

  return { data, loading, error, lastUpdated };
}
