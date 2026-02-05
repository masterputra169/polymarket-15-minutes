import React from 'react';
import { formatNumber, fmtTimeLeft } from '../utils.js';

export default function PolymarketPanel({ data }) {
  if (!data) return null;

  const { poly, marketUp, marketDown, liquidity, settlementLeftMin } = data;

  const timeColor =
    settlementLeftMin !== null
      ? settlementLeftMin >= 10
        ? 'timer--safe'
        : settlementLeftMin >= 5
          ? 'timer--warn'
          : 'timer--danger'
      : '';

  return (
    <div className="card" style={{ animationDelay: '0.2s' }}>
      <div className="card__header">
        <span className="card__title">📈 Polymarket</span>
        <span className={`card__badge ${poly?.ok ? 'badge--live' : 'badge--offline'}`}>
          {poly?.ok ? 'CONNECTED' : 'OFFLINE'}
        </span>
      </div>

      {poly?.ok && (
        <>
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              marginBottom: 10,
              lineHeight: 1.4,
              wordBreak: 'break-all',
            }}
          >
            {poly.market?.question ?? poly.market?.slug ?? '-'}
          </div>

          <div className="poly-prices">
            <div className="poly-price-box poly-price-box--up">
              <div className="poly-price-box__label c-green">↑ UP</div>
              <div className="poly-price-box__price c-green">
                {marketUp !== null ? `${marketUp}¢` : '-'}
              </div>
            </div>
            <div className="poly-price-box poly-price-box--down">
              <div className="poly-price-box__label c-red">↓ DOWN</div>
              <div className="poly-price-box__price c-red">
                {marketDown !== null ? `${marketDown}¢` : '-'}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {liquidity !== null && (
              <div className="data-row">
                <span className="data-row__label">Liquidity</span>
                <span className="data-row__value">${formatNumber(liquidity, 0)}</span>
              </div>
            )}
            {settlementLeftMin !== null && (
              <div className="data-row">
                <span className="data-row__label">Settlement in</span>
                <span className={`data-row__value ${timeColor}`}>
                  {fmtTimeLeft(settlementLeftMin)}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {!poly?.ok && (
        <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-dim)' }}>
          No active market found
          <br />
          <span style={{ fontSize: '0.7rem' }}>{poly?.reason ?? ''}</span>
        </div>
      )}
    </div>
  );
}
