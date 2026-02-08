/**
 * Funding Rate — Crypto Sentiment Indicator
 *
 * Binance perpetual futures funding rate:
 * - Positive funding = longs pay shorts → market is over-leveraged long → potential SHORT
 * - Negative funding = shorts pay longs → market is over-leveraged short → potential LONG
 * - Near zero = balanced, no strong sentiment signal
 *
 * Rate updates every 8 hours on Binance. For 15-min prediction:
 * - Not directly actionable for timing, but provides context
 * - Extreme funding (>0.05% or <-0.05%) = crowded trade → contrarian signal
 *
 * API: GET /fapi/v1/fundingRate?symbol=BTCUSDT&limit=1
 */

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';
const CACHE_TTL_MS = 5 * 60_000; // Cache 5 minutes (rate changes every 8h)

let cachedFunding = null;
let lastFetchMs = 0;

/**
 * Fetch current funding rate from Binance Futures.
 * @returns {{ rate, ratePct, extreme, sentiment, nextFundingTime } | null}
 */
export async function fetchFundingRate() {
  const now = Date.now();

  // Return cached if fresh
  if (cachedFunding && now - lastFetchMs < CACHE_TTL_MS) {
    return cachedFunding;
  }

  try {
    const resp = await fetch(
      `${BINANCE_FAPI_BASE}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1`
    );
    if (!resp.ok) return cachedFunding; // Keep stale on error

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return cachedFunding;

    const entry = data[0];
    const rate = parseFloat(entry.fundingRate);
    const ratePct = rate * 100; // Convert to percentage

    // Also fetch next funding time from premium index
    let nextFundingTime = null;
    try {
      const premResp = await fetch(
        `${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=BTCUSDT`
      );
      if (premResp.ok) {
        const prem = await premResp.json();
        nextFundingTime = prem.nextFundingTime || null;
      }
    } catch { /* silent */ }

    // Sentiment analysis
    const extreme = Math.abs(ratePct) > 0.05;
    let sentiment = 'NEUTRAL';
    if (ratePct > 0.03) sentiment = 'BEARISH'; // Longs crowded → contrarian SHORT
    else if (ratePct < -0.03) sentiment = 'BULLISH'; // Shorts crowded → contrarian LONG
    // Note: this is CONTRARIAN — high positive funding = bearish signal

    cachedFunding = {
      rate,                // Raw rate (e.g. 0.0001 = 0.01%)
      ratePct,             // As percentage (e.g. 0.01)
      extreme,             // Boolean: extreme funding
      sentiment,           // BULLISH | BEARISH | NEUTRAL (contrarian)
      nextFundingTime,     // Unix ms of next funding event
      fetchedAt: now,
    };

    lastFetchMs = now;
    return cachedFunding;
  } catch (err) {
    console.warn('[FundingRate] Fetch failed:', err.message);
    return cachedFunding; // Return stale or null
  }
}

/**
 * Get cached funding rate without fetching.
 * @returns {Object|null}
 */
export function getCachedFundingRate() {
  return cachedFunding;
}