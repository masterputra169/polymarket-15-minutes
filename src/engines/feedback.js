/**
 * ═══ Prediction Feedback Tracker v3 (Memory Optimized) ═══
 *
 * Performance problems in v1:
 *   1. loadHistory() called 2-3x per poll → JSON.parse every 5s = GC pressure
 *   2. getAccuracyStats() creates 3 intermediate arrays (.filter, .filter, .slice)
 *   3. autoSettle() re-parses entire history even when nothing to settle
 *   4. saveHistory() JSON.stringify on every tiny change
 *
 * v3 fixes (master-backend caching patterns):
 *   1. IN-MEMORY CACHE: Parse localStorage ONCE, work from memory
 *   2. DIRTY FLAG: Only write to localStorage when data actually changed
 *   3. DEBOUNCED PERSIST: Batch writes, save at most 1x/5s
 *   4. PRE-COMPUTED STATS: Cache accuracy stats, invalidate on settle
 *   5. ZERO INTERMEDIATE ARRAYS: Loop-based stats computation
 */

const STORAGE_KEY = 'btc_prediction_tracker';
const MAX_HISTORY = 30;
const PERSIST_DEBOUNCE_MS = 5_000; // Max 1 write per 5 seconds

// ═══ In-memory state (single source of truth) ═══
let cache = null;        // Array — loaded once from localStorage
let dirty = false;       // Needs localStorage write?
let persistTimer = null; // Debounce timer for saves
let statsCache = null;   // Cached getAccuracyStats result
let statsDirty = true;   // Stats need recomputation?

// ═══ Internal: Load once, cache forever ═══

function ensureLoaded() {
  if (cache !== null) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cache)) cache = [];
  } catch {
    cache = [];
  }
}

function schedulePersist() {
  if (persistTimer) return; // Already scheduled
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      // Trim before saving
      if (cache.length > MAX_HISTORY) {
        cache = cache.slice(-MAX_HISTORY);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch { /* localStorage full or disabled */ }
  }, PERSIST_DEBOUNCE_MS);
}

function markDirty() {
  dirty = true;
  statsDirty = true;
  statsCache = null;
  schedulePersist();
}

// ═══ Public API ═══

/**
 * Load prediction history (returns cached in-memory array).
 * Safe to call frequently — no JSON.parse after first call.
 */
export function loadHistory() {
  ensureLoaded();
  return cache;
}

/**
 * Record a new prediction (call when ENTER signal fires).
 * Writes to in-memory cache. Persists on debounce timer.
 */
export function recordPrediction({ side, modelProb, marketPrice, btcPrice, priceToBeat, marketSlug }) {
  ensureLoaded();

  // ═══ Dedup: Don't record if same market+side recorded in last 30s ═══
  const now = Date.now();
  for (let i = cache.length - 1; i >= Math.max(0, cache.length - 3); i--) {
    const p = cache[i];
    if (p.marketSlug === marketSlug && p.side === side && now - p.timestamp < 30_000) {
      return; // Already recorded recently
    }
  }

  cache.push({
    timestamp: now,
    side,
    modelProb,
    marketPrice,
    btcPrice,
    priceToBeat,
    marketSlug,
    settled: false,
    correct: null,
  });

  // Trim in-memory too (don't let it grow unbounded)
  if (cache.length > MAX_HISTORY + 10) {
    cache = cache.slice(-MAX_HISTORY);
  }

  markDirty();
}

/**
 * Settle a prediction (call when market resolves).
 */
export function settlePrediction(marketSlug, result) {
  ensureLoaded();
  let changed = false;

  for (let i = 0; i < cache.length; i++) {
    const pred = cache[i];
    if (pred.marketSlug === marketSlug && !pred.settled) {
      pred.settled = true;
      pred.correct = pred.side === result;
      pred.settledAt = Date.now();
      pred.actualResult = result;
      changed = true;
    }
  }

  if (changed) markDirty();
}

/**
 * Get recent accuracy stats and confidence adjustment.
 * Returns CACHED result if nothing changed since last call.
 *
 * v3: Zero intermediate arrays — single pass loop.
 *
 * @param {number} [window=20]
 */
export function getAccuracyStats(window = 20) {
  ensureLoaded();

  // Return cached stats if nothing changed
  if (!statsDirty && statsCache) return statsCache;

  // ═══ Single-pass: count settled, correct, streak — NO .filter() ═══
  let settledCount = 0;
  let correctCount = 0;

  // We need the last `window` settled predictions
  // First pass: count total settled
  for (let i = 0; i < cache.length; i++) {
    if (cache[i].settled && cache[i].correct !== null) settledCount++;
  }

  if (settledCount < 5) {
    // Not enough data — count what we have
    let correctSoFar = 0;
    for (let i = 0; i < cache.length; i++) {
      if (cache[i].settled && cache[i].correct === true) correctSoFar++;
    }
    const streak = computeStreakFromCache();
    statsCache = {
      accuracy: null,
      total: settledCount,
      correct: correctSoFar,
      confidenceMultiplier: 1.0,
      streak,
      label: `Tracking (${settledCount}/5 minimum)`,
    };
    statsDirty = false;
    return statsCache;
  }

  // Second pass: get last `window` settled results (skip non-settled)
  const windowSize = Math.min(window, settledCount);
  let skip = settledCount - windowSize;
  let recentCorrect = 0;
  let recentTotal = 0;

  // Also track streak from the end
  let streakType = null; // true = win, false = loss
  let streakCount = 0;
  let streakDone = false;

  for (let i = 0; i < cache.length; i++) {
    const p = cache[i];
    if (!p.settled || p.correct === null) continue;

    if (skip > 0) { skip--; continue; }

    recentTotal++;
    if (p.correct) recentCorrect++;
  }

  // Streak: walk from end
  for (let i = cache.length - 1; i >= 0 && !streakDone; i--) {
    const p = cache[i];
    if (!p.settled || p.correct === null) continue;

    if (streakType === null) {
      streakType = p.correct;
      streakCount = 1;
    } else if (p.correct === streakType) {
      streakCount++;
    } else {
      streakDone = true;
    }
  }

  const accuracy = recentTotal > 0 ? recentCorrect / recentTotal : null;
  const streak = {
    type: streakType === null ? 'none' : streakType ? 'win' : 'loss',
    count: streakCount,
  };

  // Confidence adjustment
  let confidenceMultiplier;
  let label;
  const pct = accuracy !== null ? (accuracy * 100).toFixed(0) : '0';

  if (accuracy >= 0.70) {
    confidenceMultiplier = 1.15;
    label = `🔥 Hot (${pct}% of last ${recentTotal})`;
  } else if (accuracy >= 0.55) {
    confidenceMultiplier = 1.05;
    label = `✅ Good (${pct}% of last ${recentTotal})`;
  } else if (accuracy >= 0.45) {
    confidenceMultiplier = 1.0;
    label = `➖ Average (${pct}% of last ${recentTotal})`;
  } else if (accuracy >= 0.35) {
    confidenceMultiplier = 0.85;
    label = `⚠️ Cold (${pct}% of last ${recentTotal})`;
  } else {
    confidenceMultiplier = 0.70;
    label = `❄️ Ice Cold (${pct}% of last ${recentTotal})`;
  }

  // Streak adjustment
  if (streak.type === 'loss' && streak.count >= 3) {
    confidenceMultiplier *= 0.90;
    label += ` | ${streak.count}L streak`;
  } else if (streak.type === 'win' && streak.count >= 3) {
    confidenceMultiplier *= 1.05;
    label += ` | ${streak.count}W streak`;
  }

  // Clamp
  if (confidenceMultiplier < 0.50) confidenceMultiplier = 0.50;
  else if (confidenceMultiplier > 1.25) confidenceMultiplier = 1.25;

  statsCache = { accuracy, total: recentTotal, correct: recentCorrect, confidenceMultiplier, streak, label };
  statsDirty = false;
  return statsCache;
}

function computeStreakFromCache() {
  for (let i = cache.length - 1; i >= 0; i--) {
    const p = cache[i];
    if (!p.settled || p.correct === null) continue;

    const streakType = p.correct;
    let count = 1;
    for (let j = i - 1; j >= 0; j--) {
      const q = cache[j];
      if (!q.settled || q.correct === null) continue;
      if (q.correct === streakType) count++;
      else break;
    }
    return { type: streakType ? 'win' : 'loss', count };
  }
  return { type: 'none', count: 0 };
}

/**
 * Auto-settle old predictions. Called each poll cycle.
 *
 * v3 optimization: Early-exit if no unsettled predictions exist.
 * Uses in-memory cache — zero JSON.parse per call.
 */
export function autoSettle(currentSlug, btcPrice, priceToBeat, timeLeftMin) {
  if (timeLeftMin > 0.5) return;

  ensureLoaded();

  // ═══ Early exit: check if ANY unsettled predictions exist ═══
  let hasUnsettled = false;
  for (let i = 0; i < cache.length; i++) {
    if (!cache[i].settled) { hasUnsettled = true; break; }
  }
  if (!hasUnsettled) return;

  let changed = false;

  for (let i = 0; i < cache.length; i++) {
    const pred = cache[i];
    if (pred.settled) continue;

    // Settle predictions from PREVIOUS markets
    if (pred.marketSlug && pred.marketSlug !== currentSlug) {
      pred.settled = true;
      pred.correct = null;
      pred.settledAt = Date.now();
      pred.actualResult = 'expired';
      changed = true;
      continue;
    }

    // Current market at settlement time
    if (priceToBeat !== null && timeLeftMin <= 0.1 && pred.marketSlug === currentSlug) {
      const result = btcPrice >= priceToBeat ? 'UP' : 'DOWN';
      pred.settled = true;
      pred.correct = pred.side === result;
      pred.settledAt = Date.now();
      pred.actualResult = result;
      changed = true;
    }
  }

  if (changed) markDirty();
}

/**
 * Force persist now (call on page unload).
 */
export function flushHistory() {
  if (!dirty || !cache) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  dirty = false;
  try {
    if (cache.length > MAX_HISTORY) cache = cache.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* */ }
}

// ═══ Persist on page unload to avoid data loss ═══
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushHistory);
}