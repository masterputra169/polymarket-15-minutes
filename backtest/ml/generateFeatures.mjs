/**
 * ═══ ML Feature Extraction v1 ═══
 *
 * Processes raw BTC candle data into ML-ready features.
 * Each 15-min window × 5 checkpoints = 1 training sample.
 *
 * Features (28 total):
 *   Numerical (16):
 *     ptb_distance_pct, rsi, rsi_slope, macd_histogram, macd_line,
 *     vwap_distance_pct, vwap_slope, ha_consecutive, delta_1m_pct,
 *     delta_3m_pct, volume_ratio, minutes_left, rule_prob_up,
 *     rule_confidence, vwap_cross_count, edge_best
 *   Categorical one-hot (12):
 *     regime_trending, regime_choppy, regime_mean_rev, regime_moderate,
 *     session_asia, session_europe, session_us, session_overlap, session_off,
 *     ha_color_green, multi_tf_agree, failed_vwap
 *
 * Label: actual_up (1 = price went up, 0 = price went down)
 *
 * Usage:
 *   node backtest/ml/generateFeatures.mjs backtest/data/btc_365d_2026-02-06.json
 *
 * Output:
 *   backtest/ml/data/features_TIMESTAMP.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══ Imports from main engine ═══
import { computeVwapSeries } from '../../src/indicators/vwap.js';
import { computeRsi, computeRsiSeries, slopeLast } from '../../src/indicators/rsi.js';
import { computeMacd } from '../../src/indicators/macd.js';
import { computeHeikenAshi, countConsecutive } from '../../src/indicators/heikenAshi.js';
import { detectRegime } from '../../src/engines/regime.js';
import { scoreDirection, applyTimeAwareness } from '../../src/engines/probability.js';
import { computeEdge } from '../../src/engines/edge.js';
import { getVolatilityProfile } from '../../src/engines/volatility.js';
import { computeMultiTfConfirmation } from '../../src/engines/multitf.js';

// ═══ Config ═══
const CONFIG = {
  vwapLookbackCandles: 60,
  rsiPeriod: 8,
  macdFast: 6,
  macdSlow: 13,
  macdSignal: 5,
  candleWindowMinutes: 15,
};

const CHECKPOINTS = [12, 8, 5, 3, 1]; // minutes left

// ═══ Feature names (for header/reference) ═══
export const FEATURE_NAMES = [
  'ptb_distance_pct',
  'rsi',
  'rsi_slope',
  'macd_histogram',
  'macd_line',
  'vwap_distance_pct',
  'vwap_slope',
  'ha_consecutive',
  'delta_1m_pct',
  'delta_3m_pct',
  'volume_ratio',
  'minutes_left',
  'rule_prob_up',
  'rule_confidence',
  'vwap_cross_count',
  'edge_best',
  // One-hot
  'regime_trending',
  'regime_choppy',
  'regime_mean_rev',
  'regime_moderate',
  'session_asia',
  'session_europe',
  'session_us',
  'session_overlap',
  'session_off',
  'ha_color_green',
  'multi_tf_agree',
  'failed_vwap',
];

// ═══ Helpers ═══
function groupIntoWindows(candles1m, windowMinutes) {
  const windows = [];
  for (let i = 0; i <= candles1m.length - windowMinutes; i += windowMinutes) {
    const wCandles = candles1m.slice(i, i + windowMinutes);
    if (wCandles.length < windowMinutes) continue;
    windows.push({
      candles: wCandles,
      startTime: wCandles[0].openTime,
      openPrice: wCandles[0].open,
      closePrice: wCandles[wCandles.length - 1].close,
    });
  }
  return windows;
}

function getLookbackCandles(allCandles, windowStartTime, count) {
  const startIdx = allCandles.findIndex(c => c.openTime >= windowStartTime);
  if (startIdx <= 0) return [];
  const from = Math.max(0, startIdx - count);
  return allCandles.slice(from, startIdx);
}

function get5mCandlesFor(candles5m, timestamp) {
  const matched = candles5m.filter(c => c.openTime <= timestamp);
  return matched.slice(-30);
}

function getSession(timestamp) {
  const h = new Date(timestamp).getUTCHours();
  if (h >= 13 && h < 16) return 'EU/US Overlap';
  if (h >= 13 && h < 22) return 'US';
  if (h >= 8 && h < 16) return 'Europe';
  if (h >= 0 && h < 8) return 'Asia';
  return 'Off-hours';
}

/**
 * Extract feature vector from a single prediction point.
 * Returns { features: number[], label: number } or null if not enough data.
 */
function extractFeatures(allCandles1m, candles5m, window, minutesLeft) {
  const candlesUsed = window.candles.length - minutesLeft;
  if (candlesUsed < 3) return null;

  const lookback = getLookbackCandles(allCandles1m, window.startTime, CONFIG.vwapLookbackCandles);
  const windowSoFar = window.candles.slice(0, candlesUsed);
  const availableCandles = [...lookback, ...windowSoFar];

  const closes = availableCandles.map(c => c.close);
  const volumes = availableCandles.map(c => c.volume);
  const price = closes[closes.length - 1];
  const priceToBeat = window.openPrice;

  // ═══ Indicators ═══
  const vwapSeries = computeVwapSeries(availableCandles, CONFIG.vwapLookbackCandles);
  const vwapNow = vwapSeries.length > 0 ? vwapSeries[vwapSeries.length - 1] : null;
  const vwapSlope = vwapSeries.length >= 5 ? slopeLast(vwapSeries, 5) : null;

  const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
  const rsiSeries = computeRsiSeries(closes, CONFIG.rsiPeriod);
  const rsiSlope = rsiSeries.length >= 3 ? slopeLast(rsiSeries, 3) : null;

  const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

  const ha = computeHeikenAshi(availableCandles);
  const consec = countConsecutive(ha);

  const close1mAgo = closes.length >= 2 ? closes[closes.length - 2] : null;
  const close3mAgo = closes.length >= 4 ? closes[closes.length - 4] : null;
  const delta1m = price && close1mAgo ? price - close1mAgo : null;
  const delta3m = price && close3mAgo ? price - close3mAgo : null;

  const vwapDist = vwapNow ? (price - vwapNow) / vwapNow : 0;
  const closesShort = closes.slice(-20);
  const vwapSeriesShort = vwapSeries.slice(-20);
  let vwapCrossCount = 0;
  for (let j = 1; j < Math.min(closesShort.length, vwapSeriesShort.length); j++) {
    const prev = closesShort[j - 1] - (vwapSeriesShort[j - 1] ?? 0);
    const curr = closesShort[j] - (vwapSeriesShort[j] ?? 0);
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) vwapCrossCount++;
  }

  let failedVwapReclaim = false;
  if (vwapNow && closesShort.length >= 5) {
    const wasBelow = closesShort.slice(-5, -2).some(c => c < vwapNow);
    const wentAbove = closesShort.slice(-3, -1).some(c => c > vwapNow);
    const nowBelow = price < vwapNow;
    if (wasBelow && wentAbove && nowBelow) failedVwapReclaim = true;
  }

  const volumeRecent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);

  const regimeInfo = detectRegime({ price, vwap: vwapNow, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg });
  const predictionTime = new Date(window.startTime + (candlesUsed * 60_000));
  const volProfile = getVolatilityProfile(predictionTime);

  const available5m = get5mCandlesFor(candles5m, window.startTime + candlesUsed * 60_000);
  const closes5m = available5m.map(c => c.close);
  const delta5m = closes5m.length >= 2 ? closes5m[closes5m.length - 1] - closes5m[closes5m.length - 2] : null;
  const ha5m = computeHeikenAshi(available5m);
  const consec5m = countConsecutive(ha5m);
  const rsi5m = computeRsi(closes5m, 8);

  const multiTfConfirm = computeMultiTfConfirmation({
    delta1m, delta3m, delta5m,
    ha1mColor: consec.color, ha5mColor: consec5m.color,
    rsi1m: rsiNow, rsi5m,
  });

  // Rule-based prediction
  const scored = scoreDirection({
    price, priceToBeat, vwap: vwapNow, vwapSlope, rsi: rsiNow, rsiSlope, macd,
    heikenColor: consec.color, heikenCount: consec.count, failedVwapReclaim,
    delta1m, delta3m, regime: regimeInfo, orderbookSignal: null,
    volProfile, multiTfConfirm, feedbackStats: null,
  });

  const timeAware = applyTimeAwareness(scored.rawUp, minutesLeft, CONFIG.candleWindowMinutes);

  const edge = computeEdge({
    modelUp: timeAware.adjustedUp,
    modelDown: timeAware.adjustedDown,
    marketYes: 0.50,
    marketNo: 0.50,
  });

  // ═══ Build feature vector ═══
  const session = getSession(window.startTime);
  const ptbDistPct = (price - priceToBeat) / priceToBeat;
  const haSignedConsec = consec.color === 'green' ? consec.count : -consec.count;
  const volRatio = volumeAvg > 0 ? volumeRecent / volumeAvg : 1;
  const bestEdge = Math.max(edge.edgeUp ?? 0, edge.edgeDown ?? 0);

  const features = [
    // Numerical (16)
    ptbDistPct,                                    // 0: ptb_distance_pct
    (rsiNow ?? 50) / 100,                          // 1: rsi (normalized 0-1)
    rsiSlope ?? 0,                                  // 2: rsi_slope
    macd?.histogram ?? 0,                           // 3: macd_histogram
    macd?.macd ?? 0,                                // 4: macd_line
    vwapDist,                                       // 5: vwap_distance_pct
    vwapSlope ?? 0,                                 // 6: vwap_slope
    haSignedConsec / 15,                            // 7: ha_consecutive (normalized)
    delta1m ? delta1m / price : 0,                  // 8: delta_1m_pct
    delta3m ? delta3m / price : 0,                  // 9: delta_3m_pct
    Math.min(volRatio, 5) / 5,                      // 10: volume_ratio (capped & normalized)
    minutesLeft / 15,                               // 11: minutes_left (normalized)
    timeAware.adjustedUp,                           // 12: rule_prob_up
    Math.abs(timeAware.adjustedUp - 0.5) * 2,      // 13: rule_confidence
    Math.min(vwapCrossCount, 10) / 10,              // 14: vwap_cross_count (normalized)
    Math.min(bestEdge, 0.5),                        // 15: edge_best (capped)

    // One-hot: Regime (4)
    regimeInfo.regime === 'trending' ? 1 : 0,       // 16
    regimeInfo.regime === 'choppy' ? 1 : 0,         // 17
    regimeInfo.regime === 'mean_reverting' ? 1 : 0,  // 18
    regimeInfo.regime === 'moderate' ? 1 : 0,        // 19

    // One-hot: Session (5)
    session === 'Asia' ? 1 : 0,                     // 20
    session === 'Europe' ? 1 : 0,                   // 21
    session === 'US' ? 1 : 0,                       // 22
    session === 'EU/US Overlap' ? 1 : 0,            // 23
    session === 'Off-hours' ? 1 : 0,                // 24

    // Binary flags (3)
    consec.color === 'green' ? 1 : 0,               // 25: ha_color_green
    multiTfConfirm.agreement ? 1 : 0,               // 26: multi_tf_agree
    failedVwapReclaim ? 1 : 0,                       // 27: failed_vwap
  ];

  // Label
  const actualUp = window.closePrice >= window.openPrice ? 1 : 0;

  return { features, label: actualUp };
}

// ═══ MAIN ═══
async function main() {
  const dataFile = process.argv[2];
  if (!dataFile) {
    console.error('Usage: node backtest/ml/generateFeatures.mjs <data-file.json>');
    process.exit(1);
  }

  console.log('\n═══ ML Feature Extraction ═══\n');
  console.log(`Loading: ${dataFile}`);

  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const candles1m = raw.data1m;
  const candles5m = raw.data5m;

  console.log(`  1m candles: ${candles1m.length}`);
  console.log(`  5m candles: ${candles5m.length}`);
  console.log(`  Period: ${raw.startTime} → ${raw.endTime}\n`);

  const windows = groupIntoWindows(candles1m, 15);
  console.log(`  15-min windows: ${windows.length}`);
  console.log(`  Expected samples: ~${windows.length * CHECKPOINTS.length}\n`);

  const allFeatures = [];
  const allLabels = [];
  let processed = 0;
  let skipped = 0;

  for (const window of windows) {
    for (const minLeft of CHECKPOINTS) {
      if (minLeft >= window.candles.length) { skipped++; continue; }

      try {
        const result = extractFeatures(candles1m, candles5m, window, minLeft);
        if (!result) { skipped++; continue; }

        // Validate — no NaN/Infinity
        const hasInvalid = result.features.some(f => !Number.isFinite(f));
        if (hasInvalid) { skipped++; continue; }

        allFeatures.push(result.features);
        allLabels.push(result.label);
      } catch (err) {
        skipped++;
      }
    }

    processed++;
    if (processed % 100 === 0) {
      process.stdout.write(`\r  Processed ${processed}/${windows.length} windows... (${allFeatures.length} samples)`);
    }
  }

  console.log(`\r  Processed ${processed}/${windows.length} windows.                    `);
  console.log(`  Valid samples: ${allFeatures.length}`);
  console.log(`  Skipped: ${skipped}`);

  // Class balance
  const upCount = allLabels.filter(l => l === 1).length;
  const downCount = allLabels.length - upCount;
  console.log(`  UP: ${upCount} (${(upCount / allLabels.length * 100).toFixed(1)}%)`);
  console.log(`  DOWN: ${downCount} (${(downCount / allLabels.length * 100).toFixed(1)}%)`);

  // Feature statistics
  console.log('\n  Feature statistics:');
  for (let i = 0; i < FEATURE_NAMES.length; i++) {
    const vals = allFeatures.map(f => f[i]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals.slice(0, 10000)); // Sample for speed
    const max = Math.max(...vals.slice(0, 10000));
    console.log(`    ${FEATURE_NAMES[i].padEnd(22)}: mean=${mean.toFixed(4)}, range=[${min.toFixed(4)}, ${max.toFixed(4)}]`);
  }

  // Save
  const outDir = path.join(__dirname, 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const outFile = path.join(outDir, `features_${timestamp}.json`);

  // Split train/test (80/20, chronological)
  const splitIdx = Math.floor(allFeatures.length * 0.8);

  const dataset = {
    featureNames: FEATURE_NAMES,
    numFeatures: FEATURE_NAMES.length,
    totalSamples: allFeatures.length,
    trainSamples: splitIdx,
    testSamples: allFeatures.length - splitIdx,
    classBalance: { up: upCount, down: downCount },
    period: { start: raw.startTime, end: raw.endTime },
    generatedAt: new Date().toISOString(),

    // Train set (first 80%)
    trainFeatures: allFeatures.slice(0, splitIdx),
    trainLabels: allLabels.slice(0, splitIdx),

    // Test set (last 20%)
    testFeatures: allFeatures.slice(splitIdx),
    testLabels: allLabels.slice(splitIdx),
  };

  fs.writeFileSync(outFile, JSON.stringify(dataset));

  const fileSizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Features saved to: ${outFile}`);
  console.log(`   File size: ${fileSizeMB} MB`);
  console.log(`   Train: ${splitIdx} samples`);
  console.log(`   Test: ${allFeatures.length - splitIdx} samples`);
  console.log(`\n🚀 Next step: node backtest/ml/trainModel.mjs ${outFile}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
