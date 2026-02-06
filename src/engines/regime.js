/**
 * Market regime detection.
 * Classifies current market as trending, mean-reverting, or choppy.
 * Used to adjust confidence in directional signals.
 */

/**
 * Detect the current market regime.
 * @param {Object} params
 * @param {number} params.price - current price
 * @param {number|null} params.vwap - current VWAP
 * @param {number|null} params.vwapSlope - VWAP slope
 * @param {number|null} params.vwapCrossCount - # of VWAP crosses in lookback
 * @param {number|null} params.volumeRecent - recent volume sum
 * @param {number|null} params.volumeAvg - average volume
 * @returns {{ regime: string, confidence: number, label: string }}
 */
export function detectRegime({ price, vwap, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg }) {
  // Default
  let regime = 'unknown';
  let confidence = 0.5;
  let label = 'Unknown';

  const hasVwap = vwap !== null && vwapSlope !== null;
  const hasVolume = volumeRecent !== null && volumeAvg !== null && volumeAvg > 0;

  if (!hasVwap) return { regime, confidence, label };

  const vwapDist = Math.abs(price - vwap) / vwap;
  const volumeRatio = hasVolume ? volumeRecent / volumeAvg : 1;

  // Choppy: many VWAP crosses + price close to VWAP
  if (vwapCrossCount !== null && vwapCrossCount >= 4 && vwapDist < 0.001) {
    regime = 'choppy';
    confidence = 0.3 + Math.min(vwapCrossCount / 10, 0.3);
    label = 'Choppy / Ranging';
    return { regime, confidence, label };
  }

  // Trending: price far from VWAP + consistent slope + volume
  if (vwapDist > 0.0005 && Math.abs(vwapSlope) > 0.5) {
    const volBoost = volumeRatio > 1.2 ? 0.15 : 0;
    regime = 'trending';
    confidence = 0.6 + Math.min(vwapDist * 100, 0.2) + volBoost;
    label = vwapSlope > 0 ? 'Trending UP' : 'Trending DOWN';
    return { regime, confidence, label };
  }

  // Mean reverting: price near VWAP, low slope
  if (vwapDist < 0.0008 && Math.abs(vwapSlope) < 0.3) {
    regime = 'mean_reverting';
    confidence = 0.5;
    label = 'Mean Reverting';
    return { regime, confidence, label };
  }

  // Default: moderate trend
  regime = 'moderate';
  confidence = 0.5;
  label = 'Moderate';

  return { regime, confidence, label };
}