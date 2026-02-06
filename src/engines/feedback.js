/**
 * ═══ Prediction Feedback Tracker ═══
 *
 * Tracks recent prediction outcomes to adjust confidence.
 * Stores last N predictions and their results in localStorage.
 *
 * Logic:
 * - If recent accuracy < 40% → reduce confidence (we're miscalibrated)
 * - If recent accuracy > 60% → slight boost (we're calibrated well)
 * - Otherwise → neutral
 *
 * This is NOT machine learning. It's a simple moving-window accuracy check
 * that acts as a "reality check" on the model's output.
 */

const STORAGE_KEY = 'btc_prediction_tracker';
const MAX_HISTORY = 30;  // Track last 30 predictions

/**
 * Load prediction history from localStorage.
 * @returns {Array} predictions [{ timestamp, side, modelProb, marketPrice, settled, correct }, ...]
 */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Save prediction history to localStorage.
 * @param {Array} history
 */
function saveHistory(history) {
  try {
    // Keep only last MAX_HISTORY entries
    const trimmed = history.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage might be full or disabled
  }
}

/**
 * Record a new prediction (call when ENTER signal fires).
 * @param {Object} prediction
 * @param {string} prediction.side - 'UP' or 'DOWN'
 * @param {number} prediction.modelProb - model probability at time of signal
 * @param {number} prediction.marketPrice - polymarket price at time of signal
 * @param {number} prediction.btcPrice - BTC price at time of signal
 * @param {number|null} prediction.priceToBeat - settlement target
 * @param {string} prediction.marketSlug - market identifier
 */
export function recordPrediction({ side, modelProb, marketPrice, btcPrice, priceToBeat, marketSlug }) {
  const history = loadHistory();
  history.push({
    timestamp: Date.now(),
    side,
    modelProb,
    marketPrice,
    btcPrice,
    priceToBeat,
    marketSlug,
    settled: false,
    correct: null,
  });
  saveHistory(history);
}

/**
 * Settle a prediction (call when market resolves).
 * @param {string} marketSlug - which market resolved
 * @param {string} result - 'UP' or 'DOWN' (actual outcome)
 */
export function settlePrediction(marketSlug, result) {
  const history = loadHistory();
  let changed = false;

  for (const pred of history) {
    if (pred.marketSlug === marketSlug && !pred.settled) {
      pred.settled = true;
      pred.correct = pred.side === result;
      pred.settledAt = Date.now();
      pred.actualResult = result;
      changed = true;
    }
  }

  if (changed) saveHistory(history);
}

/**
 * Get recent accuracy stats and confidence adjustment.
 * @param {number} [window=20] - how many recent settled predictions to consider
 * @returns {{ 
 *   accuracy: number|null, 
 *   total: number, 
 *   correct: number, 
 *   confidenceMultiplier: number,
 *   streak: { type: string, count: number },
 *   label: string 
 * }}
 */
export function getAccuracyStats(window = 20) {
  const history = loadHistory();
  const settled = history.filter(p => p.settled && p.correct !== null);

  if (settled.length < 5) {
    // Not enough data to adjust
    return {
      accuracy: null,
      total: settled.length,
      correct: settled.filter(p => p.correct).length,
      confidenceMultiplier: 1.0,
      streak: getStreak(settled),
      label: `Tracking (${settled.length}/5 minimum)`,
    };
  }

  // Use last N settled predictions
  const recent = settled.slice(-window);
  const correctCount = recent.filter(p => p.correct).length;
  const accuracy = correctCount / recent.length;
  const streak = getStreak(recent);

  // Confidence adjustment based on accuracy
  let confidenceMultiplier;
  let label;

  if (accuracy >= 0.70) {
    confidenceMultiplier = 1.15;  // Hot streak — boost
    label = `🔥 Hot (${(accuracy * 100).toFixed(0)}% of last ${recent.length})`;
  } else if (accuracy >= 0.55) {
    confidenceMultiplier = 1.05;  // Good — slight boost
    label = `✅ Good (${(accuracy * 100).toFixed(0)}% of last ${recent.length})`;
  } else if (accuracy >= 0.45) {
    confidenceMultiplier = 1.0;   // Average — no change
    label = `➖ Average (${(accuracy * 100).toFixed(0)}% of last ${recent.length})`;
  } else if (accuracy >= 0.35) {
    confidenceMultiplier = 0.85;  // Below average — reduce
    label = `⚠️ Cold (${(accuracy * 100).toFixed(0)}% of last ${recent.length})`;
  } else {
    confidenceMultiplier = 0.70;  // Very bad — strong reduce
    label = `❄️ Ice Cold (${(accuracy * 100).toFixed(0)}% of last ${recent.length})`;
  }

  // Streak adjustment
  if (streak.type === 'loss' && streak.count >= 3) {
    confidenceMultiplier *= 0.90;  // 3+ losses in a row → extra cautious
    label += ` | ${streak.count}L streak`;
  } else if (streak.type === 'win' && streak.count >= 3) {
    confidenceMultiplier *= 1.05;  // 3+ wins → slight boost
    label += ` | ${streak.count}W streak`;
  }

  return {
    accuracy,
    total: recent.length,
    correct: correctCount,
    confidenceMultiplier: Math.max(0.50, Math.min(1.25, confidenceMultiplier)),
    streak,
    label,
  };
}

/**
 * Get current win/loss streak.
 */
function getStreak(settled) {
  if (settled.length === 0) return { type: 'none', count: 0 };

  const lastResult = settled[settled.length - 1].correct;
  let count = 0;

  for (let i = settled.length - 1; i >= 0; i--) {
    if (settled[i].correct === lastResult) count++;
    else break;
  }

  return { type: lastResult ? 'win' : 'loss', count };
}

/**
 * Check if any unsettled predictions should be settled based on current market.
 * Call this each poll cycle.
 * @param {string} currentSlug - current market slug
 * @param {number} btcPrice - current BTC price
 * @param {number|null} priceToBeat - settlement target
 * @param {number} timeLeftMin - minutes until settlement
 */
export function autoSettle(currentSlug, btcPrice, priceToBeat, timeLeftMin) {
  if (timeLeftMin > 0.5) return;  // Only settle when market is about to close

  const history = loadHistory();
  let changed = false;

  for (const pred of history) {
    // Settle predictions from PREVIOUS markets (not current)
    if (!pred.settled && pred.marketSlug && pred.marketSlug !== currentSlug) {
      // This prediction was from a different (presumably older) market
      // We don't know the exact result, so mark as expired
      pred.settled = true;
      pred.correct = null;  // Unknown — expired without settlement data
      pred.settledAt = Date.now();
      pred.actualResult = 'expired';
      changed = true;
    }
  }

  // For current market predictions at settlement time
  if (priceToBeat !== null && timeLeftMin <= 0.1) {
    const result = btcPrice >= priceToBeat ? 'UP' : 'DOWN';
    for (const pred of history) {
      if (!pred.settled && pred.marketSlug === currentSlug) {
        pred.settled = true;
        pred.correct = pred.side === result;
        pred.settledAt = Date.now();
        pred.actualResult = result;
        changed = true;
      }
    }
  }

  if (changed) saveHistory(history);
}