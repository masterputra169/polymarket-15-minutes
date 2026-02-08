/**
 * ═══ Prediction Feedback Tracker v3.2 (Slug Cleanup) ═══
 *
 * v3.2 adds:
 *   1. purgeStaleMarkets() — remove predictions from old slugs
 *   2. onMarketSwitch()    — cleanup trigger for market transitions
 *   3. Age-based expiry    — auto-delete predictions older than 24h
 *   4. getStorageStats()   — monitor what's stored
 *
 * Performance from v3 preserved:
 *   In-memory cache, debounced persist, cached stats, zero JSON.parse per poll
 */

const STORAGE_KEY = 'btc_prediction_tracker';
const MAX_HISTORY = 30;
const PERSIST_DEBOUNCE_MS = 5_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SLUGS_KEPT = 5;               // Keep last 5 markets, purge older

// ═══ In-memory state ═══
let cache = null;
let dirty = false;
let persistTimer = null;
let statsCache = null;
let statsDirty = true;

// ═══ Internal helpers ═══

function ensureLoaded() {
  if (cache !== null) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cache)) cache = [];

    // Auto-purge on load: remove expired entries
    const cutoff = Date.now() - MAX_AGE_MS;
    const before = cache.length;
    cache = cache.filter(p => p.timestamp > cutoff);
    if (cache.length < before) {
      dirty = true;
      schedulePersist();
      console.log(`[Feedback] 🧹 Purged ${before - cache.length} expired predictions on load`);
    }
  } catch {
    cache = [];
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      if (cache.length > MAX_HISTORY) cache = cache.slice(-MAX_HISTORY);
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

// ═══ NEW: Slug-aware cleanup ═══

/**
 * Get unique slugs in order of appearance (newest last).
 */
function getUniqueSlugs() {
  ensureLoaded();
  const seen = new Set();
  const slugs = [];
  // Walk from newest to oldest
  for (let i = cache.length - 1; i >= 0; i--) {
    const s = cache[i].marketSlug;
    if (s && !seen.has(s)) {
      seen.add(s);
      slugs.unshift(s); // oldest first
    }
  }
  return slugs;
}

/**
 * ═══ Purge predictions from stale (old) market slugs ═══
 *
 * Keeps only the last N slugs' predictions.
 * Call after market transitions to prevent unbounded growth.
 *
 * @param {number} keepSlugs - How many recent slugs to keep (default: 5)
 * @returns {{ removed: number, slugsPurged: string[] }}
 */
export function purgeStaleMarkets(keepSlugs = MAX_SLUGS_KEPT) {
  ensureLoaded();

  const slugs = getUniqueSlugs();
  if (slugs.length <= keepSlugs) return { removed: 0, slugsPurged: [] };

  // Slugs to remove (oldest ones beyond keepSlugs)
  const staleSlugs = new Set(slugs.slice(0, slugs.length - keepSlugs));
  const before = cache.length;

  cache = cache.filter(p => !staleSlugs.has(p.marketSlug));

  const removed = before - cache.length;
  if (removed > 0) {
    markDirty();
    console.log(`[Feedback] 🧹 Purged ${removed} predictions from ${staleSlugs.size} old markets`);
  }

  return { removed, slugsPurged: [...staleSlugs] };
}

/**
 * ═══ Remove all predictions for a specific slug ═══
 *
 * @param {string} slug - Market slug to remove
 * @returns {number} Number of predictions removed
 */
export function purgeSlug(slug) {
  ensureLoaded();
  const before = cache.length;
  cache = cache.filter(p => p.marketSlug !== slug);
  const removed = before - cache.length;
  if (removed > 0) markDirty();
  return removed;
}

/**
 * ═══ Remove predictions older than maxAge ═══
 *
 * @param {number} maxAgeMs - Max age in milliseconds (default: 24h)
 * @returns {number} Number of predictions removed
 */
export function purgeOlderThan(maxAgeMs = MAX_AGE_MS) {
  ensureLoaded();
  const cutoff = Date.now() - maxAgeMs;
  const before = cache.length;
  cache = cache.filter(p => p.timestamp > cutoff);
  const removed = before - cache.length;
  if (removed > 0) markDirty();
  return removed;
}

/**
 * ═══ Called on market switch — performs targeted cleanup ═══
 *
 * This is the main cleanup trigger. Call from useMarketData
 * when slug changes.
 *
 * Actions:
 * 1. Settle unsettled predictions from old market as "expired"
 * 2. Purge old slugs beyond MAX_SLUGS_KEPT
 * 3. Purge entries older than 24h
 *
 * @param {string} oldSlug - Previous market slug
 * @param {string} newSlug - New market slug
 */
export function onMarketSwitch(oldSlug, newSlug) {
  ensureLoaded();
  if (!oldSlug || oldSlug === newSlug) return;

  let changed = false;
  const now = Date.now();

  // 1. Settle unsettled predictions from old market
  for (let i = 0; i < cache.length; i++) {
    const p = cache[i];
    if (p.marketSlug === oldSlug && !p.settled) {
      p.settled = true;
      p.correct = null; // Unknown — market ended
      p.settledAt = now;
      p.actualResult = 'expired';
      changed = true;
    }
  }

  // 2. Purge old slugs
  purgeStaleMarkets(MAX_SLUGS_KEPT);

  // 3. Purge entries older than 24h
  const cutoff = now - MAX_AGE_MS;
  const before = cache.length;
  cache = cache.filter(p => p.timestamp > cutoff);
  if (cache.length < before) changed = true;

  if (changed) markDirty();

  console.log(`[Feedback] 🔄 Market switch: "${oldSlug.slice(-20)}" → "${newSlug.slice(-20)}" | ${cache.length} predictions kept`);
}

/**
 * ═══ Get storage stats for monitoring ═══
 */
export function getStorageStats() {
  ensureLoaded();
  const slugs = getUniqueSlugs();
  const settled = cache.filter(p => p.settled).length;
  const unsettled = cache.length - settled;
  const oldestMs = cache.length > 0 ? Date.now() - cache[0].timestamp : 0;

  return {
    total: cache.length,
    settled,
    unsettled,
    slugs: slugs.length,
    slugList: slugs.slice(-5), // Last 5
    oldestMinutesAgo: Math.floor(oldestMs / 60_000),
    storageBytesEstimate: JSON.stringify(cache).length,
  };
}

/**
 * ═══ Clear ALL prediction data ═══
 * Nuclear option — use for debugging.
 */
export function clearAll() {
  cache = [];
  markDirty();
  // Also persist immediately
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
  console.log('[Feedback] 🗑️ All prediction data cleared');
}

// ═══ Core API (unchanged from v3) ═══

export function loadHistory() {
  ensureLoaded();
  return cache;
}

export function recordPrediction({ side, modelProb, marketPrice, btcPrice, priceToBeat, marketSlug }) {
  ensureLoaded();

  // Dedup: same market+side in last 30s
  const now = Date.now();
  for (let i = cache.length - 1; i >= Math.max(0, cache.length - 3); i--) {
    const p = cache[i];
    if (p.marketSlug === marketSlug && p.side === side && now - p.timestamp < 30_000) return;
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

  if (cache.length > MAX_HISTORY + 10) cache = cache.slice(-MAX_HISTORY);
  markDirty();
}

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

export function getAccuracyStats(window = 20) {
  ensureLoaded();
  if (!statsDirty && statsCache) return statsCache;

  let settledCount = 0;
  for (let i = 0; i < cache.length; i++) {
    if (cache[i].settled && cache[i].correct !== null) settledCount++;
  }

  if (settledCount < 5) {
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

  const windowSize = Math.min(window, settledCount);
  let skip = settledCount - windowSize;
  let recentCorrect = 0;
  let recentTotal = 0;
  let streakType = null;
  let streakCount = 0;
  let streakDone = false;

  for (let i = 0; i < cache.length; i++) {
    const p = cache[i];
    if (!p.settled || p.correct === null) continue;
    if (skip > 0) { skip--; continue; }
    recentTotal++;
    if (p.correct) recentCorrect++;
  }

  for (let i = cache.length - 1; i >= 0 && !streakDone; i--) {
    const p = cache[i];
    if (!p.settled || p.correct === null) continue;
    if (streakType === null) { streakType = p.correct; streakCount = 1; }
    else if (p.correct === streakType) streakCount++;
    else streakDone = true;
  }

  const accuracy = recentTotal > 0 ? recentCorrect / recentTotal : null;
  const streak = { type: streakType === null ? 'none' : streakType ? 'win' : 'loss', count: streakCount };

  let confidenceMultiplier, label;
  const pct = accuracy !== null ? (accuracy * 100).toFixed(0) : '0';

  if (accuracy >= 0.70) { confidenceMultiplier = 1.15; label = `🔥 Hot (${pct}% of last ${recentTotal})`; }
  else if (accuracy >= 0.55) { confidenceMultiplier = 1.05; label = `✅ Good (${pct}% of last ${recentTotal})`; }
  else if (accuracy >= 0.45) { confidenceMultiplier = 1.0; label = `➖ Average (${pct}% of last ${recentTotal})`; }
  else if (accuracy >= 0.35) { confidenceMultiplier = 0.85; label = `⚠️ Cold (${pct}% of last ${recentTotal})`; }
  else { confidenceMultiplier = 0.70; label = `❄️ Ice Cold (${pct}% of last ${recentTotal})`; }

  if (streak.type === 'loss' && streak.count >= 3) { confidenceMultiplier *= 0.90; label += ` | ${streak.count}L streak`; }
  else if (streak.type === 'win' && streak.count >= 3) { confidenceMultiplier *= 1.05; label += ` | ${streak.count}W streak`; }

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

export function autoSettle(currentSlug, btcPrice, priceToBeat, timeLeftMin) {
  if (timeLeftMin > 0.5) return;
  ensureLoaded();

  let hasUnsettled = false;
  for (let i = 0; i < cache.length; i++) {
    if (!cache[i].settled) { hasUnsettled = true; break; }
  }
  if (!hasUnsettled) return;

  let changed = false;
  for (let i = 0; i < cache.length; i++) {
    const pred = cache[i];
    if (pred.settled) continue;

    if (pred.marketSlug && pred.marketSlug !== currentSlug) {
      pred.settled = true;
      pred.correct = null;
      pred.settledAt = Date.now();
      pred.actualResult = 'expired';
      changed = true;
      continue;
    }

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

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushHistory);
}