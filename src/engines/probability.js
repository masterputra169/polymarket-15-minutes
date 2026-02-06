/**
 * ═══ REWORKED Probability Engine for 15-Minute Polymarket ═══
 *
 * Key changes from original:
 * 1. "Distance to Price to Beat" is now the PRIMARY indicator (weight 5)
 * 2. Short-term momentum (delta 1m/3m) weighted higher than long-term (VWAP/MACD)
 * 3. Time decay uses sqrt curve with floor (never kills signals completely)
 * 4. MACD/VWAP weights reduced (less relevant for 15-min windows)
 *
 * WEIGHT TABLE:
 *   Price to PTB distance:  +5  (NEW — strongest signal)
 *   Delta momentum (1m/3m): +3  (NEW — short-term momentum)
 *   RSI + Slope:            +2  (keep)
 *   MACD Histogram:         +1  (reduced from 2)
 *   MACD Line:              +1  (keep)
 *   VWAP position:          +1  (reduced from 2)
 *   VWAP Slope:             +1  (reduced from 2)
 *   Heiken Ashi:            +1  (keep)
 *   Failed VWAP Reclaim:    +2  (reduced from 3)
 *   Total possible per side: ~17
 */

/**
 * Score directional bias based on all indicators.
 *
 * @param {Object} params
 * @param {number} params.price - current BTC price
 * @param {number|null} params.priceToBeat - settlement target price
 * @param {number|null} params.vwap - current VWAP
 * @param {number|null} params.vwapSlope
 * @param {number|null} params.rsi - current RSI
 * @param {number|null} params.rsiSlope
 * @param {Object|null} params.macd - { hist, histDelta, line }
 * @param {string|null} params.heikenColor - 'green' or 'red'
 * @param {number} params.heikenCount - consecutive HA candle count
 * @param {boolean} params.failedVwapReclaim
 * @param {number|null} params.delta1m - price change last 1 min
 * @param {number|null} params.delta3m - price change last 3 min
 * @returns {{ upScore: number, downScore: number, totalWeight: number, rawUp: number, rawDown: number, breakdown: Object }}
 */
export function scoreDirection({
  price,
  priceToBeat = null,
  vwap = null,
  vwapSlope = null,
  rsi = null,
  rsiSlope = null,
  macd = null,
  heikenColor = null,
  heikenCount = 0,
  failedVwapReclaim = false,
  delta1m = null,
  delta3m = null,
  regime = null,
}) {
  let upScore = 1;   // base
  let downScore = 1;  // base
  const breakdown = {};

  // ═══ 1. DISTANCE TO PRICE TO BEAT (weight: 5) ═══
  // This is THE most important signal. If price is far above/below the
  // settlement target with time left, probability should be very directional.
  if (priceToBeat !== null && price !== null && priceToBeat > 0) {
    const distance = price - priceToBeat;
    const distPct = distance / priceToBeat;  // e.g., +0.002 = +0.2%

    // Graduated scoring based on distance
    // BTC moves ~0.1-0.3% in 15 min normally
    if (Math.abs(distPct) > 0.003) {
      // Very far (>0.3%) — almost certain
      if (distance > 0) upScore += 5;
      else downScore += 5;
      breakdown.ptbDistance = { signal: distance > 0 ? 'STRONG UP' : 'STRONG DOWN', weight: 5, distPct };
    } else if (Math.abs(distPct) > 0.0015) {
      // Moderate (0.15-0.3%) — strong lean
      if (distance > 0) upScore += 3;
      else downScore += 3;
      breakdown.ptbDistance = { signal: distance > 0 ? 'UP' : 'DOWN', weight: 3, distPct };
    } else if (Math.abs(distPct) > 0.0005) {
      // Close (0.05-0.15%) — slight lean
      if (distance > 0) upScore += 1.5;
      else downScore += 1.5;
      breakdown.ptbDistance = { signal: distance > 0 ? 'LEAN UP' : 'LEAN DOWN', weight: 1.5, distPct };
    } else {
      // Very close (<0.05%) — toss-up
      breakdown.ptbDistance = { signal: 'NEUTRAL', weight: 0, distPct };
    }
  } else {
    breakdown.ptbDistance = { signal: 'N/A', weight: 0 };
  }

  // ═══ 2. DELTA MOMENTUM 1m/3m (weight: 3) ═══
  // Short-term momentum is highly predictive for 15-minute settlement
  if (delta1m !== null && delta3m !== null) {
    const bothUp = delta1m > 0 && delta3m > 0;
    const bothDown = delta1m < 0 && delta3m < 0;
    const accelerating1m = Math.abs(delta1m) > Math.abs(delta3m) / 3;

    if (bothUp && accelerating1m) {
      upScore += 3;
      breakdown.momentum = { signal: 'STRONG UP', weight: 3 };
    } else if (bothDown && accelerating1m) {
      downScore += 3;
      breakdown.momentum = { signal: 'STRONG DOWN', weight: 3 };
    } else if (bothUp) {
      upScore += 2;
      breakdown.momentum = { signal: 'UP', weight: 2 };
    } else if (bothDown) {
      downScore += 2;
      breakdown.momentum = { signal: 'DOWN', weight: 2 };
    } else if (delta1m > 0) {
      upScore += 1;
      breakdown.momentum = { signal: 'LEAN UP', weight: 1 };
    } else if (delta1m < 0) {
      downScore += 1;
      breakdown.momentum = { signal: 'LEAN DOWN', weight: 1 };
    } else {
      breakdown.momentum = { signal: 'NEUTRAL', weight: 0 };
    }
  } else if (delta1m !== null) {
    if (delta1m > 0) { upScore += 1; breakdown.momentum = { signal: 'LEAN UP', weight: 1 }; }
    else if (delta1m < 0) { downScore += 1; breakdown.momentum = { signal: 'LEAN DOWN', weight: 1 }; }
    else breakdown.momentum = { signal: 'NEUTRAL', weight: 0 };
  } else {
    breakdown.momentum = { signal: 'N/A', weight: 0 };
  }

  // ═══ 3. RSI + Slope (weight: 2) ═══
  if (rsi !== null) {
    // RSI thresholds adjusted for period 8 (more volatile, wider bands)
    if (rsi >= 60 && (rsiSlope === null || rsiSlope >= 0)) {
      upScore += 2;
      breakdown.rsi = { signal: 'UP', weight: 2 };
    } else if (rsi <= 40 && (rsiSlope === null || rsiSlope <= 0)) {
      downScore += 2;
      breakdown.rsi = { signal: 'DOWN', weight: 2 };
    } else if (rsi >= 55) {
      upScore += 1;
      breakdown.rsi = { signal: 'LEAN UP', weight: 1 };
    } else if (rsi <= 45) {
      downScore += 1;
      breakdown.rsi = { signal: 'LEAN DOWN', weight: 1 };
    } else {
      breakdown.rsi = { signal: 'NEUTRAL', weight: 0 };
    }
  } else {
    breakdown.rsi = { signal: 'N/A', weight: 0 };
  }

  // ═══ 4. MACD Histogram (weight: 1, reduced from 2) ═══
  if (macd !== null) {
    const expanding = macd.histDelta !== null &&
      ((macd.hist > 0 && macd.histDelta > 0) || (macd.hist < 0 && macd.histDelta < 0));

    if (macd.hist > 0) {
      upScore += expanding ? 1 : 0.5;
      breakdown.macdHist = { signal: expanding ? 'UP (expanding)' : 'UP', weight: expanding ? 1 : 0.5 };
    } else if (macd.hist < 0) {
      downScore += expanding ? 1 : 0.5;
      breakdown.macdHist = { signal: expanding ? 'DOWN (expanding)' : 'DOWN', weight: expanding ? 1 : 0.5 };
    } else {
      breakdown.macdHist = { signal: 'NEUTRAL', weight: 0 };
    }

    // MACD line (weight: 1)
    if (macd.line > 0) {
      upScore += 1;
      breakdown.macdLine = { signal: 'UP', weight: 1 };
    } else if (macd.line < 0) {
      downScore += 1;
      breakdown.macdLine = { signal: 'DOWN', weight: 1 };
    } else {
      breakdown.macdLine = { signal: 'NEUTRAL', weight: 0 };
    }
  } else {
    breakdown.macdHist = { signal: 'N/A', weight: 0 };
    breakdown.macdLine = { signal: 'N/A', weight: 0 };
  }

  // ═══ 5. VWAP Position (weight: 1, reduced from 2) ═══
  if (vwap !== null && price !== null) {
    if (price > vwap) {
      upScore += 1;
      breakdown.vwapPos = { signal: 'UP', weight: 1 };
    } else if (price < vwap) {
      downScore += 1;
      breakdown.vwapPos = { signal: 'DOWN', weight: 1 };
    } else {
      breakdown.vwapPos = { signal: 'NEUTRAL', weight: 0 };
    }
  } else {
    breakdown.vwapPos = { signal: 'N/A', weight: 0 };
  }

  // ═══ 6. VWAP Slope (weight: 1, reduced from 2) ═══
  if (vwapSlope !== null) {
    if (vwapSlope > 0.1) {
      upScore += 1;
      breakdown.vwapSlope = { signal: 'UP', weight: 1 };
    } else if (vwapSlope < -0.1) {
      downScore += 1;
      breakdown.vwapSlope = { signal: 'DOWN', weight: 1 };
    } else {
      breakdown.vwapSlope = { signal: 'NEUTRAL', weight: 0 };
    }
  } else {
    breakdown.vwapSlope = { signal: 'N/A', weight: 0 };
  }

  // ═══ 7. Heiken Ashi Consecutive (weight: 1) ═══
  if (heikenColor && heikenCount >= 2) {
    if (heikenColor.toLowerCase() === 'green') {
      upScore += 1;
      breakdown.heikenAshi = { signal: 'UP', weight: 1, count: heikenCount };
    } else if (heikenColor.toLowerCase() === 'red') {
      downScore += 1;
      breakdown.heikenAshi = { signal: 'DOWN', weight: 1, count: heikenCount };
    } else {
      breakdown.heikenAshi = { signal: 'NEUTRAL', weight: 0, count: heikenCount };
    }
  } else {
    breakdown.heikenAshi = { signal: 'NEUTRAL', weight: 0, count: heikenCount };
  }

  // ═══ 8. Failed VWAP Reclaim (weight: 2, reduced from 3) ═══
  if (failedVwapReclaim) {
    downScore += 2;
    breakdown.failedVwap = { signal: 'DOWN', weight: 2 };
  } else {
    breakdown.failedVwap = { signal: 'N/A', weight: 0 };
  }

  // ═══ CALCULATE RAW PROBABILITY ═══
  const totalWeight = upScore + downScore;
  let rawUp = totalWeight > 0 ? upScore / totalWeight : 0.5;

  // ═══ 9. REGIME ADJUSTMENT ═══
  // Trending   → boost confidence (amplify distance from 50%)
  // Choppy     → reduce confidence (compress toward 50%)
  // Mean Rev   → slightly reduce
  // Other      → no change
  //
  // Formula: adjustedRaw = 0.5 + (rawUp - 0.5) * regimeMultiplier
  //
  // | Regime        | Multiplier | rawUp 65% → adjusted |
  // |---------------|------------|----------------------|
  // | Trending      | 1.25       | 65% → 68.75%         |
  // | Moderate      | 1.00       | 65% → 65%            |
  // | Mean Reverting| 0.80       | 65% → 62%            |
  // | Choppy        | 0.60       | 65% → 59%            |
  let regimeMultiplier = 1.0;
  let regimeEffect = 'NONE';

  if (regime && regime.regime) {
    switch (regime.regime) {
      case 'trending':
        regimeMultiplier = 1.25;
        regimeEffect = `BOOST (${regime.label})`;
        break;
      case 'choppy':
        regimeMultiplier = 0.60;
        regimeEffect = `DAMPEN (${regime.label})`;
        break;
      case 'mean_reverting':
        regimeMultiplier = 0.80;
        regimeEffect = `SLIGHT DAMPEN (${regime.label})`;
        break;
      default:
        regimeMultiplier = 1.0;
        regimeEffect = 'NEUTRAL';
        break;
    }

    rawUp = 0.5 + (rawUp - 0.5) * regimeMultiplier;
    // Clamp to valid probability range
    rawUp = Math.max(0.02, Math.min(0.98, rawUp));
  }

  breakdown.regime = { effect: regimeEffect, multiplier: regimeMultiplier };

  const rawDown = 1 - rawUp;

  return { upScore, downScore, totalWeight, rawUp, rawDown, breakdown };
}

/**
 * Apply time-awareness to raw probability.
 *
 * ═══ REWORKED TIME DECAY ═══
 * Old: linear decay → killed all signals in LATE phase
 * New: sqrt curve with floor → still allows confident signals near settlement
 *
 * Formula: timeDecay = max(FLOOR, sqrt(timeLeft / totalWindow))
 *
 * | Time Left | Old Decay | New Decay | rawUp 70% → adjusted |
 * |-----------|-----------|-----------|----------------------|
 * | 15 min    | 1.00      | 1.00      | 70% → 70%            |
 * | 10 min    | 0.67      | 0.82      | 70% → 66%            |
 * | 7 min     | 0.47      | 0.68      | 70% → 64%            |
 * | 5 min     | 0.33      | 0.58      | 70% → 62%            |
 * | 3 min     | 0.20      | 0.45      | 70% → 59%            |
 * | 1 min     | 0.07      | 0.35*     | 70% → 57%            |
 *   * = clamped to floor of 0.35
 *
 * This means LATE phase (< 5 min) still has meaningful signal strength,
 * especially when Price to Beat distance is large.
 *
 * @param {number} rawUp - raw probability (0-1)
 * @param {number} timeLeftMin - minutes until settlement
 * @param {number} totalWindowMin - total market window (15)
 * @returns {{ adjustedUp: number, adjustedDown: number, timeDecay: number }}
 */
export function applyTimeAwareness(rawUp, timeLeftMin, totalWindowMin = 15) {
  const FLOOR = 0.35;  // minimum decay — never fully flatten

  if (timeLeftMin === null || timeLeftMin === undefined || !Number.isFinite(timeLeftMin)) {
    return { adjustedUp: rawUp, adjustedDown: 1 - rawUp, timeDecay: 1 };
  }

  const ratio = Math.max(0, Math.min(1, timeLeftMin / totalWindowMin));
  const rawDecay = Math.sqrt(ratio);  // sqrt curve — much gentler than linear
  const timeDecay = Math.max(FLOOR, rawDecay);

  const adjustedUp = 0.5 + (rawUp - 0.5) * timeDecay;
  const adjustedDown = 1 - adjustedUp;

  return { adjustedUp, adjustedDown, timeDecay };
}