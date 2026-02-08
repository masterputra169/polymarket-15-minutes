import React, { memo, useState } from 'react';
import { formatNumber, formatSignedDelta, narrativeFromSign } from '../utils.js';

function SignalRow({ name, value, narrative }) {
  const cls =
    narrative === 'LONG'
      ? 'ta-signal-row--long'
      : narrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';

  const colorCls =
    narrative === 'LONG' ? 'c-green' : narrative === 'SHORT' ? 'c-red' : 'c-muted';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">{name}</span>
      <span className={`ta-signal-row__value ${colorCls}`}>{value}</span>
    </div>
  );
}

/** Custom row for Bollinger Bands with squeeze badge */
function BollingerRow({ bb }) {
  if (!bb) {
    return (
      <div className="ta-signal-row ta-signal-row--neutral">
        <span className="ta-signal-row__name">BB</span>
        <span className="ta-signal-row__value c-muted">-</span>
      </div>
    );
  }

  const { width, percentB, squeeze, squeezeIntensity } = bb;
  const bbNarrative = percentB > 0.8 ? 'SHORT' : percentB < 0.2 ? 'LONG' : 'NEUTRAL';
  const cls =
    bbNarrative === 'LONG'
      ? 'ta-signal-row--long'
      : bbNarrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';

  const colorCls =
    bbNarrative === 'LONG' ? 'c-green' : bbNarrative === 'SHORT' ? 'c-red' : 'c-muted';

  const widthPct = (width * 100).toFixed(2);
  const bPct = (percentB * 100).toFixed(0);

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">
        BB
        {squeeze && (
          <span
            style={{
              marginLeft: 6,
              fontSize: '0.58rem',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(255,171,0,0.12)',
              color: 'var(--yellow-bright)',
              border: '1px solid rgba(255,171,0,0.25)',
              letterSpacing: '0.04em',
            }}
          >
            SQUEEZE {squeezeIntensity >= 0.5 ? '🔥' : ''}
          </span>
        )}
      </span>
      <span className={`ta-signal-row__value ${colorCls}`}>
        %B: {bPct}% | W: {widthPct}%
      </span>
    </div>
  );
}

/** Custom row for ATR with expanding/contracting indicator */
function AtrRow({ atr }) {
  if (!atr) {
    return (
      <div className="ta-signal-row ta-signal-row--neutral">
        <span className="ta-signal-row__name">ATR</span>
        <span className="ta-signal-row__value c-muted">-</span>
      </div>
    );
  }

  const { atr: atrVal, atrPct, atrRatio, expanding } = atr;
  const narrative = expanding ? 'SHORT' : atrRatio < 0.8 ? 'LONG' : 'NEUTRAL';
  const cls =
    narrative === 'LONG'
      ? 'ta-signal-row--long'
      : narrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';

  const ratioLabel = atrRatio > 1.2
    ? '↑ HIGH'
    : atrRatio < 0.8
      ? '↓ LOW'
      : '→ NORMAL';

  const ratioColor = atrRatio > 1.2
    ? 'c-red'
    : atrRatio < 0.8
      ? 'c-cyan'
      : 'c-muted';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">ATR</span>
      <span className="ta-signal-row__value">
        <span style={{ color: 'var(--text-primary)' }}>
          ${formatNumber(atrVal, 0)}
        </span>
        <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>
          ({atrPct.toFixed(2)}%)
        </span>
        <span className={ratioColor} style={{ fontWeight: 600, fontSize: '0.68rem' }}>
          {ratioLabel}
        </span>
      </span>
    </div>
  );
}

/** ═══ Volume Delta row with buy/sell pressure ═══ */
function VolumeDeltaRow({ volDelta }) {
  if (!volDelta) {
    return (
      <div className="ta-signal-row ta-signal-row--neutral">
        <span className="ta-signal-row__name">Vol Delta</span>
        <span className="ta-signal-row__value c-muted">-</span>
      </div>
    );
  }

  const { buyRatio, netDeltaPct, deltaAccel, buyDominant } = volDelta;
  const narrative = buyDominant ? 'LONG' : buyRatio < 0.48 ? 'SHORT' : 'NEUTRAL';
  const cls =
    narrative === 'LONG'
      ? 'ta-signal-row--long'
      : narrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';
  const colorCls =
    narrative === 'LONG' ? 'c-green' : narrative === 'SHORT' ? 'c-red' : 'c-muted';

  const buyPct = (buyRatio * 100).toFixed(1);
  const accelArrow = deltaAccel > 0.02 ? ' ⬆' : deltaAccel < -0.02 ? ' ⬇' : '';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">Vol Delta</span>
      <span className={`ta-signal-row__value ${colorCls}`}>
        Buy: {buyPct}% | Net: {netDeltaPct > 0 ? '+' : ''}{netDeltaPct.toFixed(1)}%{accelArrow}
      </span>
    </div>
  );
}

/** ═══ EMA Crossover row ═══ */
function EmaCrossRow({ emaCross }) {
  if (!emaCross) {
    return (
      <div className="ta-signal-row ta-signal-row--neutral">
        <span className="ta-signal-row__name">EMA 8/21</span>
        <span className="ta-signal-row__value c-muted">-</span>
      </div>
    );
  }

  const { distancePct, cross, bullish, crossBars } = emaCross;
  const narrative = bullish ? 'LONG' : 'SHORT';
  const cls = bullish ? 'ta-signal-row--long' : 'ta-signal-row--short';
  const colorCls = bullish ? 'c-green' : 'c-red';

  const hasCross = cross !== 'NONE';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">
        EMA 8/21
        {hasCross && (
          <span
            style={{
              marginLeft: 6,
              fontSize: '0.58rem',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              background: cross === 'BULL_CROSS' ? 'rgba(0,230,118,0.12)' : 'rgba(255,82,82,0.12)',
              color: cross === 'BULL_CROSS' ? 'var(--green-bright)' : 'var(--red-bright)',
              border: `1px solid ${cross === 'BULL_CROSS' ? 'rgba(0,230,118,0.25)' : 'rgba(255,82,82,0.25)'}`,
              letterSpacing: '0.04em',
            }}
          >
            {cross === 'BULL_CROSS' ? '✦ CROSS ↑' : '✦ CROSS ↓'}
          </span>
        )}
      </span>
      <span className={`ta-signal-row__value ${colorCls}`}>
        {bullish ? '↑' : '↓'} {distancePct > 0 ? '+' : ''}{distancePct.toFixed(3)}%
        {crossBars < 5 && <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: '0.65rem' }}>({crossBars}b ago)</span>}
      </span>
    </div>
  );
}

/** ═══ Stochastic RSI row ═══ */
function StochRsiRow({ stochRsi }) {
  if (!stochRsi) {
    return (
      <div className="ta-signal-row ta-signal-row--neutral">
        <span className="ta-signal-row__name">StochRSI</span>
        <span className="ta-signal-row__value c-muted">-</span>
      </div>
    );
  }

  const { k, d, cross, overbought, oversold, signal } = stochRsi;
  const narrative = overbought ? 'SHORT' : oversold ? 'LONG' : signal;
  const cls =
    narrative === 'LONG'
      ? 'ta-signal-row--long'
      : narrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';
  const colorCls =
    narrative === 'LONG' ? 'c-green' : narrative === 'SHORT' ? 'c-red' : 'c-muted';

  const zoneLabel = overbought ? ' OB' : oversold ? ' OS' : '';
  const crossLabel = cross === 'BULL_CROSS' ? ' ↑X' : cross === 'BEAR_CROSS' ? ' ↓X' : '';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">StochRSI</span>
      <span className={`ta-signal-row__value ${colorCls}`}>
        K: {k.toFixed(0)} | D: {d.toFixed(0)}{zoneLabel}{crossLabel}
      </span>
    </div>
  );
}

/** ═══ Funding Rate row ═══ */
function FundingRateRow({ fundingRate }) {
  if (!fundingRate) {
    return (
      <div className="ta-signal-row ta-signal-row--neutral">
        <span className="ta-signal-row__name">Funding</span>
        <span className="ta-signal-row__value c-muted">-</span>
      </div>
    );
  }

  const { ratePct, extreme, sentiment } = fundingRate;
  const narrative = sentiment === 'BULLISH' ? 'LONG' : sentiment === 'BEARISH' ? 'SHORT' : 'NEUTRAL';
  const cls =
    narrative === 'LONG'
      ? 'ta-signal-row--long'
      : narrative === 'SHORT'
        ? 'ta-signal-row--short'
        : 'ta-signal-row--neutral';
  const colorCls =
    narrative === 'LONG' ? 'c-green' : narrative === 'SHORT' ? 'c-red' : 'c-muted';

  return (
    <div className={`ta-signal-row ${cls}`}>
      <span className="ta-signal-row__name">
        Funding
        {extreme && (
          <span
            style={{
              marginLeft: 6,
              fontSize: '0.58rem',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(255,82,82,0.12)',
              color: 'var(--red-bright)',
              border: '1px solid rgba(255,82,82,0.25)',
              letterSpacing: '0.04em',
            }}
          >
            EXTREME
          </span>
        )}
      </span>
      <span className={`ta-signal-row__value ${colorCls}`}>
        {ratePct >= 0 ? '+' : ''}{ratePct.toFixed(4)}%
        <span style={{ color: 'var(--text-dim)', marginLeft: 4, fontSize: '0.65rem' }}>
          ({sentiment.toLowerCase()})
        </span>
      </span>
    </div>
  );
}

/** ═══ Hidden Features Panel (collapsible) ═══ */
function HiddenFeatures({ data }) {
  const [expanded, setExpanded] = useState(false);

  const {
    volumeRatio, vwapCrossCount, multiTfConfirm,
    failedVwapReclaim, regimeInfo, realizedVol,
  } = data;

  const volRatioColor = (volumeRatio ?? 1) > 1.5 ? 'c-green' : (volumeRatio ?? 1) < 0.6 ? 'c-red' : 'c-muted';
  const volRatioLabel = (volumeRatio ?? 1) > 1.5 ? 'HIGH' : (volumeRatio ?? 1) < 0.6 ? 'LOW' : 'NORMAL';

  const mtfLabel = multiTfConfirm?.agreement
    ? `✓ ${multiTfConfirm.direction?.toUpperCase() || 'AGREE'}`
    : '✗ DISAGREE';
  const mtfColor = multiTfConfirm?.agreement ? 'c-green' : 'c-red';

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 4 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 0',
          fontSize: '0.65rem',
          color: 'var(--text-dim)',
          userSelect: 'none',
        }}
      >
        <span>🔍 Hidden Features</span>
        <span style={{ fontSize: '0.6rem' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ fontSize: '0.65rem', lineHeight: 1.8 }}>
          <div className="ta-signal-row ta-signal-row--neutral" style={{ padding: '1px 8px' }}>
            <span className="ta-signal-row__name">Vol Ratio</span>
            <span className={`ta-signal-row__value ${volRatioColor}`} style={{ fontSize: '0.65rem' }}>
              {volumeRatio?.toFixed(2) ?? '-'}x ({volRatioLabel})
            </span>
          </div>

          <div className="ta-signal-row ta-signal-row--neutral" style={{ padding: '1px 8px' }}>
            <span className="ta-signal-row__name">VWAP Crosses</span>
            <span className="ta-signal-row__value c-muted" style={{ fontSize: '0.65rem' }}>
              {vwapCrossCount ?? '-'} (20b)
              {(vwapCrossCount ?? 0) >= 6 &&
                <span style={{ color: 'var(--yellow-bright)', marginLeft: 4 }}>CHOPPY</span>
              }
            </span>
          </div>

          <div className="ta-signal-row ta-signal-row--neutral" style={{ padding: '1px 8px' }}>
            <span className="ta-signal-row__name">Multi-TF</span>
            <span className={`ta-signal-row__value ${mtfColor}`} style={{ fontSize: '0.65rem' }}>
              {mtfLabel}
              {multiTfConfirm?.score !== undefined &&
                <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>
                  ({multiTfConfirm.score}/5)
                </span>
              }
            </span>
          </div>

          <div className="ta-signal-row ta-signal-row--neutral" style={{ padding: '1px 8px' }}>
            <span className="ta-signal-row__name">VWAP Reclaim</span>
            <span className={`ta-signal-row__value ${failedVwapReclaim ? 'c-red' : 'c-muted'}`} style={{ fontSize: '0.65rem' }}>
              {failedVwapReclaim ? '✗ FAILED' : '—'}
            </span>
          </div>

          <div className="ta-signal-row ta-signal-row--neutral" style={{ padding: '1px 8px' }}>
            <span className="ta-signal-row__name">Regime</span>
            <span className="ta-signal-row__value" style={{ fontSize: '0.65rem', color: 'var(--cyan-bright)' }}>
              {regimeInfo?.regime?.toUpperCase() ?? '-'}
              {regimeInfo?.confidence !== undefined &&
                <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>
                  ({(regimeInfo.confidence * 100).toFixed(0)}%)
                </span>
              }
            </span>
          </div>

          {realizedVol !== null && realizedVol !== undefined && (
            <div className="ta-signal-row ta-signal-row--neutral" style={{ padding: '1px 8px' }}>
              <span className="ta-signal-row__name">Realized Vol</span>
              <span className="ta-signal-row__value c-muted" style={{ fontSize: '0.65rem' }}>
                {(realizedVol * 100).toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function TAIndicators({ data }) {
  if (!data) return null;

  const {
    consec,
    haNarrative,
    rsiNow,
    rsiSlope,
    rsiNarrative,
    macdLabel,
    macdNarrative,
    delta1m,
    delta3m,
    lastClose,
    vwapNow,
    vwapDist,
    vwapSlopeLabel,
    vwapNarrative,
    bb,
    atr,
    volDelta,
    emaCross,
    stochRsi,
    fundingRate,
  } = data;

  const heikenValue = `${consec?.color ?? '-'} x${consec?.count ?? 0}`;

  const rsiArrow =
    rsiSlope !== null && rsiSlope < 0 ? '↓' : rsiSlope !== null && rsiSlope > 0 ? '↑' : '-';
  const rsiValue = `${formatNumber(rsiNow, 1)} ${rsiArrow}`;

  const delta1Narrative = narrativeFromSign(delta1m);
  const delta3Narrative = narrativeFromSign(delta3m);

  const d1 = formatSignedDelta(delta1m, lastClose);
  const d3 = formatSignedDelta(delta3m, lastClose);

  const vwapValue = `${formatNumber(vwapNow, 0)} (${vwapDist !== null ? (vwapDist * 100).toFixed(2) + '%' : '-'}) | slope: ${vwapSlopeLabel}`;

  return (
    <div className="card" style={{ animationDelay: '0.1s' }}>
      <div className="card__header">
        <span className="card__title">📊 TA Indicators</span>
        <span className="card__badge badge--live">LIVE</span>
      </div>

      {/* ── Core Indicators ── */}
      <SignalRow name="Heiken Ashi" value={heikenValue} narrative={haNarrative} />
      <SignalRow name="RSI" value={rsiValue} narrative={rsiNarrative} />
      <SignalRow name="MACD" value={macdLabel} narrative={macdNarrative} />
      <BollingerRow bb={bb} />
      <AtrRow atr={atr} />

      {/* ── NEW Indicators ── */}
      <EmaCrossRow emaCross={emaCross} />
      <VolumeDeltaRow volDelta={volDelta} />
      <StochRsiRow stochRsi={stochRsi} />
      <FundingRateRow fundingRate={fundingRate} />

      {/* ── Micro-momentum ── */}
      <SignalRow name="Delta 1min" value={d1} narrative={delta1Narrative} />
      <SignalRow name="Delta 3min" value={d3} narrative={delta3Narrative} />
      <SignalRow name="VWAP" value={vwapValue} narrative={vwapNarrative} />

      {/* ── Hidden Features (collapsible) ── */}
      <HiddenFeatures data={data} />
    </div>
  );
}

// ═══ React.memo with custom comparator ═══
export default memo(TAIndicators, (prev, next) => {
  const a = prev.data;
  const b = next.data;
  if (!a || !b) return a === b;
  return (
    a.consec?.color === b.consec?.color &&
    a.consec?.count === b.consec?.count &&
    a.haNarrative === b.haNarrative &&
    a.rsiNow === b.rsiNow &&
    a.rsiSlope === b.rsiSlope &&
    a.rsiNarrative === b.rsiNarrative &&
    a.macdLabel === b.macdLabel &&
    a.macdNarrative === b.macdNarrative &&
    a.delta1m === b.delta1m &&
    a.delta3m === b.delta3m &&
    a.lastClose === b.lastClose &&
    a.vwapNow === b.vwapNow &&
    a.vwapDist === b.vwapDist &&
    a.vwapSlopeLabel === b.vwapSlopeLabel &&
    a.vwapNarrative === b.vwapNarrative &&
    a.bb?.width === b.bb?.width &&
    a.bb?.percentB === b.bb?.percentB &&
    a.bb?.squeeze === b.bb?.squeeze &&
    a.atr?.atr === b.atr?.atr &&
    a.atr?.atrRatio === b.atr?.atrRatio &&
    // New indicators
    a.volDelta?.buyRatio === b.volDelta?.buyRatio &&
    a.volDelta?.netDeltaPct === b.volDelta?.netDeltaPct &&
    a.emaCross?.distancePct === b.emaCross?.distancePct &&
    a.emaCross?.cross === b.emaCross?.cross &&
    a.stochRsi?.k === b.stochRsi?.k &&
    a.stochRsi?.d === b.stochRsi?.d &&
    a.fundingRate?.ratePct === b.fundingRate?.ratePct &&
    // Hidden features
    a.volumeRatio === b.volumeRatio &&
    a.vwapCrossCount === b.vwapCrossCount &&
    a.failedVwapReclaim === b.failedVwapReclaim &&
    a.regimeInfo?.regime === b.regimeInfo?.regime &&
    a.multiTfConfirm?.agreement === b.multiTfConfirm?.agreement
  );
});