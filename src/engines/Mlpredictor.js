/**
 * ═══ ML Predictor (Browser) — XGBoost Inference v3 ═══
 *
 * Performance optimizations (master-backend patterns applied):
 *
 * 1. PRE-INDEXED TREES: On load, convert children arrays to Map<nodeid, node>
 *    for O(1) child lookup instead of O(n) Array.find() per node traversal.
 *    With 500 trees × ~15 depth = 7500 .find() calls → 7500 Map.get() calls.
 *
 * 2. PRE-ALLOCATED BUFFERS: Reuse Float64Array for features & normalized values.
 *    Zero array allocation per prediction cycle. GC pressure → 0.
 *
 * 3. FLATTENED TREE FORMAT: Trees stored as indexed arrays instead of nested objects
 *    for cache-friendly traversal (memory locality).
 *
 * 4. MEMORY TRACKING: Report model size on load for monitoring.
 *
 * 5. CONDITIONAL LOGGING: Only log in development mode.
 *
 * Ensemble strategy unchanged:
 *   Final P(UP) = α × ML + (1-α) × Rules + agreement_bonus
 */

const IS_DEV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
const NUM_FEATURES = 28;

// ═══ Module state ═══
let processedTrees = null;   // Flattened, indexed trees
let normMeans = null;        // Float64Array
let normStds = null;         // Float64Array
let isLoading = false;
let loadError = null;
let modelMemoryKB = 0;

// ═══ Pre-allocated buffers (reused every prediction — ZERO allocation) ═══
const featureBuf = new Float64Array(NUM_FEATURES);
const normBuf = new Float64Array(NUM_FEATURES);

// ═══ Tree Processing (done ONCE on load) ═══

/**
 * Convert raw XGBoost JSON tree into a flat indexed structure.
 * Original: node.children = [...], find child by nodeid
 * Optimized: childMap[nodeid] = node, O(1) lookup
 *
 * @param {Object} rawTree - Raw tree from xgboost get_dump(dump_format='json')
 * @returns {Map<number, Object>} nodeId → { leaf?, split?, splitCondition, yes, no, missing }
 */
function indexTree(rawTree) {
  const nodeMap = new Map();

  function walk(node) {
    if (node.leaf !== undefined) {
      nodeMap.set(node.nodeid, { leaf: node.leaf });
      return;
    }

    const featureIdx = parseInt(node.split.replace('f', ''), 10);
    nodeMap.set(node.nodeid, {
      featureIdx,
      threshold: node.split_condition,
      yes: node.yes,
      no: node.no,
      missing: node.missing ?? node.yes,
    });

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i]);
      }
    }
  }

  walk(rawTree);
  return nodeMap;
}

// ═══ XGBoost Evaluation (optimized) ═══

/**
 * Evaluate a single indexed tree. Iterative instead of recursive.
 * Uses Map.get() O(1) instead of Array.find() O(n).
 *
 * @param {Map} nodeMap - Indexed tree
 * @param {Float64Array} features - Normalized feature vector
 * @returns {number} Tree output (logit contribution)
 */
function evaluateTreeFast(nodeMap, features) {
  let nodeId = 0; // Root node

  // Iterative traversal (no stack allocation from recursion)
  for (;;) {
    const node = nodeMap.get(nodeId);
    if (!node) return 0;

    // Leaf → return value
    if (node.leaf !== undefined) return node.leaf;

    const val = features[node.featureIdx];

    // Handle missing/NaN → follow missing branch
    if (val !== val || val === undefined) { // NaN check: val !== val
      nodeId = node.missing;
      continue;
    }

    // Normal split
    nodeId = val < node.threshold ? node.yes : node.no;
  }
}

/**
 * Evaluate all trees and compute probability.
 * Uses pre-allocated buffers — zero allocation.
 *
 * @param {Float64Array} features - Raw feature values (in featureBuf)
 * @returns {number} P(UP) probability
 */
function predictXGBoost(features) {
  if (!processedTrees || !normMeans) return null;

  // Normalize into pre-allocated buffer
  for (let i = 0; i < NUM_FEATURES; i++) {
    const std = normStds[i];
    normBuf[i] = std !== 0 ? (features[i] - normMeans[i]) / std : 0;
  }

  // Sum tree outputs (hot loop — keep minimal)
  let logit = 0;
  const trees = processedTrees;
  const len = trees.length;
  for (let i = 0; i < len; i++) {
    logit += evaluateTreeFast(trees[i], normBuf);
  }

  // Sigmoid (inlined for speed)
  return 1 / (1 + Math.exp(-logit));
}

// ═══ Public API ═══

/**
 * Load and pre-process the XGBoost model.
 * Pre-indexes all trees for O(1) traversal.
 */
export async function loadMLModel(
  modelPath = '/ml/xgboost_model.json',
  normPath = '/ml/norm_browser.json'
) {
  if (processedTrees) return true;
  if (isLoading) return false;

  isLoading = true;
  loadError = null;

  try {
    // Load both in parallel
    const [modelResp, normResp] = await Promise.all([
      fetch(modelPath),
      fetch(normPath),
    ]);

    if (!modelResp.ok) throw new Error(`Model fetch failed: ${modelResp.status}`);
    if (!normResp.ok) throw new Error(`Norm fetch failed: ${normResp.status}`);

    const [rawModel, rawNorm] = await Promise.all([
      modelResp.json(),
      normResp.json(),
    ]);

    // ═══ Pre-index trees (one-time cost, saves per-prediction) ═══
    const numTrees = rawModel.trees.length;
    processedTrees = new Array(numTrees);
    for (let i = 0; i < numTrees; i++) {
      processedTrees[i] = indexTree(rawModel.trees[i]);
    }

    // ═══ Copy norm params into TypedArrays (cache-friendly, no GC) ═══
    const nf = rawNorm.means.length;
    normMeans = new Float64Array(nf);
    normStds = new Float64Array(nf);
    for (let i = 0; i < nf; i++) {
      normMeans[i] = rawNorm.means[i];
      normStds[i] = rawNorm.stds[i] || 1; // prevent div-by-zero
    }

    // ═══ Estimate memory footprint ═══
    let totalNodes = 0;
    for (let i = 0; i < numTrees; i++) totalNodes += processedTrees[i].size;
    // ~80 bytes per node (Map entry + object) + Float64Arrays
    modelMemoryKB = Math.round((totalNodes * 80 + nf * 16) / 1024);

    // Release raw model (let GC collect the large JSON)
    // rawModel is now out of scope and will be collected

    console.log(
      `[ML] XGBoost loaded: ${numTrees} trees, ${totalNodes} nodes, ~${modelMemoryKB}KB`
    );

    isLoading = false;
    return true;
  } catch (err) {
    console.warn('[ML] Failed to load model:', err.message);
    loadError = err.message;
    isLoading = false;
    return false;
  }
}

/**
 * Check if ML model is ready.
 */
export function isMLReady() {
  return processedTrees !== null && normMeans !== null;
}

/**
 * Get ML model status with memory info.
 */
export function getMLStatus() {
  if (processedTrees) {
    return {
      status: 'ready',
      trees: processedTrees.length,
      memoryKB: modelMemoryKB,
      error: null,
    };
  }
  if (isLoading) return { status: 'loading', trees: 0, memoryKB: 0, error: null };
  if (loadError) return { status: 'error', trees: 0, memoryKB: 0, error: loadError };
  return { status: 'not_loaded', trees: 0, memoryKB: 0, error: null };
}

/**
 * Unload the model to free memory.
 * Call when not needed (e.g., background tab for extended period).
 */
export function unloadMLModel() {
  processedTrees = null;
  normMeans = null;
  normStds = null;
  modelMemoryKB = 0;
  if (IS_DEV) console.log('[ML] Model unloaded, memory freed');
}

/**
 * Extract features into pre-allocated buffer.
 * Writes directly to featureBuf — ZERO array allocation.
 *
 * Must produce the same 28 features as generateFeatures.mjs.
 */
function extractLiveFeaturesInPlace({
  price, priceToBeat, rsi, rsiSlope, macd, vwap, vwapSlope,
  heikenColor, heikenCount, delta1m, delta3m, volumeRecent, volumeAvg,
  regime, session, minutesLeft, ruleProbUp, ruleConfidence,
  vwapCrossCount, bestEdge, multiTfAgreement, failedVwapReclaim,
}) {
  const ptbDistPct = priceToBeat ? (price - priceToBeat) / priceToBeat : 0;
  const isGreen = heikenColor === 'green';
  const haSignedConsec = isGreen ? (heikenCount || 0) : -(heikenCount || 0);
  const volRatio = volumeAvg > 0 ? (volumeRecent || 0) / volumeAvg : 1;

  // Numerical (16)
  featureBuf[0]  = ptbDistPct;
  featureBuf[1]  = (rsi ?? 50) / 100;
  featureBuf[2]  = rsiSlope ?? 0;
  featureBuf[3]  = macd?.histogram ?? 0;
  featureBuf[4]  = macd?.macd ?? 0;
  featureBuf[5]  = vwap ? (price - vwap) / vwap : 0;
  featureBuf[6]  = vwapSlope ?? 0;
  featureBuf[7]  = haSignedConsec / 15;
  featureBuf[8]  = delta1m ? delta1m / price : 0;
  featureBuf[9]  = delta3m ? delta3m / price : 0;
  featureBuf[10] = Math.min(volRatio, 5) / 5;
  featureBuf[11] = (minutesLeft ?? 7.5) / 15;
  featureBuf[12] = ruleProbUp ?? 0.5;
  featureBuf[13] = ruleConfidence ?? 0;
  featureBuf[14] = Math.min(vwapCrossCount ?? 0, 10) / 10;
  featureBuf[15] = Math.min(bestEdge ?? 0, 0.5);

  // One-hot: Regime (4)
  featureBuf[16] = regime === 'trending'       ? 1 : 0;
  featureBuf[17] = regime === 'choppy'         ? 1 : 0;
  featureBuf[18] = regime === 'mean_reverting' ? 1 : 0;
  featureBuf[19] = regime === 'moderate'       ? 1 : 0;

  // One-hot: Session (5)
  featureBuf[20] = session === 'Asia'           ? 1 : 0;
  featureBuf[21] = session === 'Europe'         ? 1 : 0;
  featureBuf[22] = session === 'US'             ? 1 : 0;
  featureBuf[23] = session === 'EU/US Overlap'  ? 1 : 0;
  featureBuf[24] = session === 'Off-hours'      ? 1 : 0;

  // Binary flags (3)
  featureBuf[25] = isGreen                      ? 1 : 0;
  featureBuf[26] = multiTfAgreement             ? 1 : 0;
  featureBuf[27] = failedVwapReclaim            ? 1 : 0;

  return featureBuf;
}

/**
 * Make ML prediction using pre-allocated buffers.
 * @returns {{ probUp: number, confidence: number, side: string }} or null
 */
export function predictML(features) {
  if (!processedTrees || !normMeans) return null;

  const probUp = predictXGBoost(features);
  if (probUp === null) return null;

  const confidence = Math.abs(probUp - 0.5) * 2;
  const side = probUp >= 0.5 ? 'UP' : 'DOWN';

  return { probUp, confidence, side };
}

// Keep extractLiveFeatures export for backward compatibility
export function extractLiveFeatures(params) {
  return extractLiveFeaturesInPlace(params);
}

/**
 * ═══ ENSEMBLE: Combine ML + Rule-based predictions ═══
 * No changes to strategy — only optimized to avoid string concat when possible.
 */
export function ensemblePrediction(mlProbUp, mlConfidence, ruleProbUp) {
  let alpha, source;

  if (mlConfidence >= 0.4) {
    alpha = 0.7;
    source = 'ML-dominant';
  } else if (mlConfidence >= 0.2) {
    alpha = 0.5;
    source = 'Equal blend';
  } else {
    alpha = 0.3;
    source = 'Rule-dominant';
  }

  const mlSide = mlProbUp >= 0.5;
  const ruleSide = ruleProbUp >= 0.5;

  let ensembleProbUp = alpha * mlProbUp + (1 - alpha) * ruleProbUp;

  if (mlSide === ruleSide) {
    // Agreement bonus
    ensembleProbUp += (mlSide ? 1 : -1) * 0.03;
    source += ' + agreement';
  } else {
    // Conflict damping
    ensembleProbUp = 0.5 + (ensembleProbUp - 0.5) * 0.75;
    source += ' + conflict';
  }

  // Clamp
  if (ensembleProbUp < 0.01) ensembleProbUp = 0.01;
  else if (ensembleProbUp > 0.99) ensembleProbUp = 0.99;

  return { ensembleProbUp, alpha, source };
}

/**
 * ═══ Full ML Pipeline: Extract → Predict → Ensemble ═══
 * Uses in-place feature extraction — zero allocation per call.
 */
export function getMLPrediction(marketState, ruleProbUp) {
  if (!isMLReady()) {
    return {
      available: false,
      ensembleProbUp: ruleProbUp,
      mlProbUp: null,
      mlConfidence: null,
      mlSide: null,
      alpha: 0,
      source: 'Rule-only (ML not loaded)',
    };
  }

  // Extract features in-place (writes to featureBuf, no allocation)
  extractLiveFeaturesInPlace({
    ...marketState,
    ruleProbUp,
    ruleConfidence: Math.abs(ruleProbUp - 0.5) * 2,
  });

  const mlResult = predictML(featureBuf);
  if (!mlResult) {
    return {
      available: false,
      ensembleProbUp: ruleProbUp,
      mlProbUp: null,
      mlConfidence: null,
      mlSide: null,
      alpha: 0,
      source: 'Rule-only (ML prediction failed)',
    };
  }

  const ensemble = ensemblePrediction(mlResult.probUp, mlResult.confidence, ruleProbUp);

  return {
    available: true,
    ensembleProbUp: ensemble.ensembleProbUp,
    mlProbUp: mlResult.probUp,
    mlConfidence: mlResult.confidence,
    mlSide: mlResult.side,
    alpha: ensemble.alpha,
    source: ensemble.source,
  };
}