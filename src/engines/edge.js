/**
 * ═══ REWORKED Edge & Decision Engine ═══
 *
 * Key changes:
 * 1. LATE phase thresholds lowered to work WITH new time decay (not against it)
 * 2. Added VERY_LATE phase (< 2 min) with lowest thresholds for high-confidence entries
 * 3. Edge = difference between model probability and market price (value bet detection)
 *
 * PHASE TABLE:
 * | Phase     | Time Left | Min Edge | Min Prob | Rationale                           |
 * |-----------|-----------|----------|----------|-------------------------------------|
 * | EARLY     | > 10 min  | 5%       | 55%      | Still developing, need moderate edge |
 * | MID       | 5-10 min  | 8%       | 55%      | More data, slightly higher edge req  |
 * | LATE      | 2-5 min   | 10%      | 55%      | Good info, need solid edge           |
 * | VERY_LATE | < 2 min   | 12%      | 55%      | Most info but less time to converge  |
 *
 * Old LATE was 20% edge + 65% prob → IMPOSSIBLE with old time decay.
 * New LATE is 10% edge + 55% prob → achievable with sqrt time decay floor.
 */

/**
 * Compute edge: model probability minus market price.
 * Positive edge means our model thinks the event is more likely than the market prices it.
 *
 * @param {Object} params
 * @param {number} params.modelUp - model P(up) (0-1)
 * @param {number} params.modelDown - model P(down) (0-1)
 * @param {number|null} params.marketYes - market price for YES/UP (0-1)
 * @param {number|null} params.marketNo - market price for NO/DOWN (0-1)
 * @returns {{ edgeUp: number|null, edgeDown: number|null, bestSide: string|null, bestEdge: number|null }}
 */
export function computeEdge({ modelUp, modelDown, marketYes, marketNo }) {
  const edgeUp = marketYes !== null && Number.isFinite(marketYes)
    ? modelUp - marketYes
    : null;
  const edgeDown = marketNo !== null && Number.isFinite(marketNo)
    ? modelDown - marketNo
    : null;

  let bestSide = null;
  let bestEdge = null;

  if (edgeUp !== null && edgeDown !== null) {
    if (edgeUp >= edgeDown && edgeUp > 0) {
      bestSide = 'UP';
      bestEdge = edgeUp;
    } else if (edgeDown > 0) {
      bestSide = 'DOWN';
      bestEdge = edgeDown;
    }
  } else if (edgeUp !== null && edgeUp > 0) {
    bestSide = 'UP';
    bestEdge = edgeUp;
  } else if (edgeDown !== null && edgeDown > 0) {
    bestSide = 'DOWN';
    bestEdge = edgeDown;
  }

  return { edgeUp, edgeDown, bestSide, bestEdge };
}

/**
 * Phase-based decision: should we enter a position?
 *
 * @param {Object} params
 * @param {number} params.remainingMinutes
 * @param {number|null} params.edgeUp
 * @param {number|null} params.edgeDown
 * @param {number} params.modelUp - adjusted P(up)
 * @param {number} params.modelDown - adjusted P(down)
 * @returns {{ action: string, side: string|null, confidence: string, phase: string, reason: string }}
 */
export function decide({ remainingMinutes, edgeUp, edgeDown, modelUp, modelDown }) {
  // Determine phase
  let phase, minEdge, minProb;

  if (remainingMinutes > 10) {
    phase = 'EARLY';
    minEdge = 0.05;
    minProb = 0.55;
  } else if (remainingMinutes > 5) {
    phase = 'MID';
    minEdge = 0.08;
    minProb = 0.55;
  } else if (remainingMinutes > 2) {
    phase = 'LATE';
    minEdge = 0.10;
    minProb = 0.55;
  } else {
    phase = 'VERY_LATE';
    minEdge = 0.12;
    minProb = 0.55;
  }

  // Check UP side
  const upPass = edgeUp !== null && edgeUp >= minEdge && modelUp >= minProb;
  // Check DOWN side
  const downPass = edgeDown !== null && edgeDown >= minEdge && modelDown >= minProb;

  if (upPass && downPass) {
    // Both pass — pick the stronger edge
    if (edgeUp >= edgeDown) {
      return {
        action: 'ENTER',
        side: 'UP',
        confidence: getConfidence(edgeUp, modelUp),
        phase,
        reason: `UP edge ${(edgeUp * 100).toFixed(1)}% > min ${(minEdge * 100).toFixed(0)}%, model ${(modelUp * 100).toFixed(0)}% > ${(minProb * 100).toFixed(0)}%`,
      };
    } else {
      return {
        action: 'ENTER',
        side: 'DOWN',
        confidence: getConfidence(edgeDown, modelDown),
        phase,
        reason: `DOWN edge ${(edgeDown * 100).toFixed(1)}% > min ${(minEdge * 100).toFixed(0)}%, model ${(modelDown * 100).toFixed(0)}% > ${(minProb * 100).toFixed(0)}%`,
      };
    }
  }

  if (upPass) {
    return {
      action: 'ENTER',
      side: 'UP',
      confidence: getConfidence(edgeUp, modelUp),
      phase,
      reason: `UP edge ${(edgeUp * 100).toFixed(1)}% > min ${(minEdge * 100).toFixed(0)}%, model ${(modelUp * 100).toFixed(0)}% > ${(minProb * 100).toFixed(0)}%`,
    };
  }

  if (downPass) {
    return {
      action: 'ENTER',
      side: 'DOWN',
      confidence: getConfidence(edgeDown, modelDown),
      phase,
      reason: `DOWN edge ${(edgeDown * 100).toFixed(1)}% > min ${(minEdge * 100).toFixed(0)}%, model ${(modelDown * 100).toFixed(0)}% > ${(minProb * 100).toFixed(0)}%`,
    };
  }

  // No edge found
  const bestEdge = Math.max(edgeUp ?? -Infinity, edgeDown ?? -Infinity);
  const bestSide = (edgeUp ?? -1) >= (edgeDown ?? -1) ? 'UP' : 'DOWN';
  const bestProb = bestSide === 'UP' ? modelUp : modelDown;

  return {
    action: 'WAIT',
    side: null,
    confidence: 'NONE',
    phase,
    reason: `Best: ${bestSide} edge ${(bestEdge * 100).toFixed(1)}% (need ${(minEdge * 100).toFixed(0)}%), prob ${(bestProb * 100).toFixed(0)}% (need ${(minProb * 100).toFixed(0)}%)`,
  };
}

/**
 * Map edge + probability to confidence level.
 */
function getConfidence(edge, prob) {
  if (edge >= 0.20 && prob >= 0.65) return 'HIGH';
  if (edge >= 0.12 && prob >= 0.58) return 'MEDIUM';
  return 'LOW';
}