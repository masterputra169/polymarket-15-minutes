/**
 * ═══ ML Predictor (Browser) — XGBoost Inference ═══
 *
 * Loads exported XGBoost model (JSON) and evaluates trees in pure JS.
 * Zero dependencies — works in any browser.
 *
 * Ensemble strategy:
 *   Final P(UP) = α × ML + (1-α) × Rules + agreement_bonus
 *
 * Where α adapts based on ML confidence:
 *   - ML confidence > 70% → α = 0.7
 *   - ML confidence 60-70% → α = 0.5
 *   - ML confidence < 60% → α = 0.3
 */

let xgbModel = null;
let normParams = null;
let isLoading = false;
let loadError = null;

// ═══ XGBoost Tree Evaluation ═══

/**
 * Evaluate a single XGBoost tree node recursively.
 * Tree format from xgboost get_dump(dump_format='json'):
 *   { nodeid, split, split_condition, yes, no, missing, children: [...] }
 *   or leaf: { nodeid, leaf }
 */
function evaluateTree(node, features) {
  // Leaf node — return value
  if (node.leaf !== undefined) {
    return node.leaf;
  }

  // Split node
  const featureIdx = parseInt(node.split.replace('f', ''), 10);
  const featureVal = features[featureIdx];
  const threshold = node.split_condition;

  // Handle missing values
  if (featureVal === null || featureVal === undefined || isNaN(featureVal)) {
    // Follow missing branch (default: yes branch)
    const missingId = node.missing ?? node.yes;
    const child = node.children.find(c => c.nodeid === missingId);
    return child ? evaluateTree(child, features) : 0;
  }

  // Normal split: left if < threshold, right otherwise
  let nextId;
  if (featureVal < threshold) {
    nextId = node.yes;
  } else {
    nextId = node.no;
  }

  const child = node.children.find(c => c.nodeid === nextId);
  return child ? evaluateTree(child, features) : 0;
}

/**
 * Evaluate all trees and compute final probability.
 * XGBoost binary classification: sigmoid(sum of all tree outputs + base_score_logit)
 */
function predictXGBoost(features) {
  if (!xgbModel) return null;

  // Normalize features
  const normalized = normParams
    ? features.map((val, i) => (val - normParams.means[i]) / normParams.stds[i])
    : features;

  // Sum tree outputs
  let logit = 0;
  for (const tree of xgbModel.trees) {
    logit += evaluateTree(tree, normalized);
  }

  // Apply base score (convert to logit space then add)
  // XGBoost base_score for binary classification is typically 0.5
  // In logit space: log(0.5 / (1 - 0.5)) = 0
  // So base_score of 0.5 adds 0 in logit space

  // Sigmoid
  const probUp = 1 / (1 + Math.exp(-logit));

  return probUp;
}

// ═══ Public API ═══

/**
 * Load the XGBoost model and normalization parameters.
 * Call once at app startup.
 */
export async function loadMLModel(
  modelPath = '/ml/xgboost_model.json',
  normPath = '/ml/norm_browser.json'
) {
  if (xgbModel) return true;
  if (isLoading) return false;

  isLoading = true;
  loadError = null;

  try {
    // Load model
    const modelResp = await fetch(modelPath);
    if (!modelResp.ok) throw new Error(`Model fetch failed: ${modelResp.status}`);
    xgbModel = await modelResp.json();
    console.log(`[ML] XGBoost model loaded: ${xgbModel.num_trees} trees, ${xgbModel.num_features} features`);

    // Load normalization
    const normResp = await fetch(normPath);
    if (!normResp.ok) throw new Error(`Norm fetch failed: ${normResp.status}`);
    normParams = await normResp.json();
    console.log(`[ML] Normalization loaded: ${normParams.means.length} features`);

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
  return xgbModel !== null && normParams !== null;
}

/**
 * Get ML model status.
 */
export function getMLStatus() {
  if (xgbModel) return { status: 'ready', trees: xgbModel.num_trees, error: null };
  if (isLoading) return { status: 'loading', trees: 0, error: null };
  if (loadError) return { status: 'error', trees: 0, error: loadError };
  return { status: 'not_loaded', trees: 0, error: null };
}

/**
 * Extract feature vector from current market state.
 * Must produce the same 28 features as generateFeatures.mjs.
 */
export function extractLiveFeatures({
  price,
  priceToBeat,
  rsi,
  rsiSlope,
  macd,
  vwap,
  vwapSlope,
  heikenColor,
  heikenCount,
  delta1m,
  delta3m,
  volumeRecent,
  volumeAvg,
  regime,
  session,
  minutesLeft,
  ruleProbUp,
  ruleConfidence,
  vwapCrossCount,
  bestEdge,
  multiTfAgreement,
  failedVwapReclaim,
}) {
  const ptbDistPct = priceToBeat ? (price - priceToBeat) / priceToBeat : 0;
  const haSignedConsec = heikenColor === 'green' ? (heikenCount || 0) : -(heikenCount || 0);
  const volRatio = volumeAvg > 0 ? (volumeRecent || 0) / volumeAvg : 1;

  return [
    // Numerical (16)
    ptbDistPct,
    (rsi ?? 50) / 100,
    rsiSlope ?? 0,
    macd?.histogram ?? 0,
    macd?.macd ?? 0,
    vwap ? (price - vwap) / vwap : 0,
    vwapSlope ?? 0,
    haSignedConsec / 15,
    delta1m ? delta1m / price : 0,
    delta3m ? delta3m / price : 0,
    Math.min(volRatio, 5) / 5,
    (minutesLeft ?? 7.5) / 15,
    ruleProbUp ?? 0.5,
    ruleConfidence ?? 0,
    Math.min(vwapCrossCount ?? 0, 10) / 10,
    Math.min(bestEdge ?? 0, 0.5),

    // One-hot: Regime (4)
    regime === 'trending' ? 1 : 0,
    regime === 'choppy' ? 1 : 0,
    regime === 'mean_reverting' ? 1 : 0,
    regime === 'moderate' ? 1 : 0,

    // One-hot: Session (5)
    session === 'Asia' ? 1 : 0,
    session === 'Europe' ? 1 : 0,
    session === 'US' ? 1 : 0,
    session === 'EU/US Overlap' ? 1 : 0,
    session === 'Off-hours' ? 1 : 0,

    // Binary flags (3)
    heikenColor === 'green' ? 1 : 0,
    multiTfAgreement ? 1 : 0,
    failedVwapReclaim ? 1 : 0,
  ];
}

/**
 * Make ML prediction.
 * @param {number[]} features - Raw feature vector (28 elements)
 * @returns {{ probUp: number, confidence: number, side: string }} or null
 */
export function predictML(features) {
  if (!xgbModel || !normParams) return null;

  const probUp = predictXGBoost(features);
  if (probUp === null) return null;

  const confidence = Math.abs(probUp - 0.5) * 2; // 0-1 scale
  const side = probUp >= 0.5 ? 'UP' : 'DOWN';

  return { probUp, confidence, side };
}

/**
 * ═══ ENSEMBLE: Combine ML + Rule-based predictions ═══
 */
export function ensemblePrediction(mlProbUp, mlConfidence, ruleProbUp) {
  // Adaptive alpha
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

  // Agreement bonus
  const mlSide = mlProbUp >= 0.5 ? 'UP' : 'DOWN';
  const ruleSide = ruleProbUp >= 0.5 ? 'UP' : 'DOWN';

  let ensembleProbUp = alpha * mlProbUp + (1 - alpha) * ruleProbUp;

  if (mlSide === ruleSide) {
    const direction = mlSide === 'UP' ? 1 : -1;
    ensembleProbUp += direction * 0.03;
    source += ' + agreement';
  } else {
    ensembleProbUp = 0.5 + (ensembleProbUp - 0.5) * 0.75;
    source += ' + conflict';
  }

  ensembleProbUp = Math.max(0.01, Math.min(0.99, ensembleProbUp));

  return { ensembleProbUp, alpha, source };
}

/**
 * ═══ Full ML Pipeline: Extract → Predict → Ensemble ═══
 */
export function getMLPrediction(marketState, ruleProbUp) {
  if (!isMLReady()) {
    return {
      available: false,
      ensembleProbUp: ruleProbUp,
      mlProbUp: null,
      mlConfidence: null,
      alpha: 0,
      source: 'Rule-only (ML not loaded)',
    };
  }

  const features = extractLiveFeatures({
    ...marketState,
    ruleProbUp,
    ruleConfidence: Math.abs(ruleProbUp - 0.5) * 2,
  });

  const mlResult = predictML(features);
  if (!mlResult) {
    return {
      available: false,
      ensembleProbUp: ruleProbUp,
      mlProbUp: null,
      mlConfidence: null,
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