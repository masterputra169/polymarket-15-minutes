import React, { useEffect, useRef } from 'react';
import { formatNumber, fmtTimeLeft } from '../utils.js';

export default function CurrentPriceCard({
  chainlinkPrice,
  chainlinkPrevPrice,
  chainlinkConnected,
  chainlinkSource,
  binancePrice,
  binancePrevPrice,
  binanceConnected,
  timeLeftMin,
}) {
  const priceRef = useRef(null);
  const prevRef = useRef(chainlinkPrice);

  useEffect(() => {
    if (chainlinkPrice !== null && prevRef.current !== null && chainlinkPrice !== prevRef.current) {
      const el = priceRef.current;
      if (!el) return;
      const cls = chainlinkPrice > prevRef.current ? 'flash-green' : 'flash-red';
      el.classList.remove('flash-green', 'flash-red');
      void el.offsetWidth;
      el.classList.add(cls);
    }
    prevRef.current = chainlinkPrice;
  }, [chainlinkPrice]);

  const displayPrice = chainlinkPrice ?? binancePrice;
  const prevDisplay = chainlinkPrevPrice ?? binancePrevPrice;

  let priceColor = '';
  let arrow = '';
  if (displayPrice !== null && prevDisplay !== null && displayPrice !== prevDisplay) {
    if (displayPrice > prevDisplay) {
      priceColor = 'c-green';
      arrow = ' ↑';
    } else {
      priceColor = 'c-red';
      arrow = ' ↓';
    }
  }

  // Diff between Binance and Chainlink
  let diffText = '';
  if (binancePrice && chainlinkPrice && chainlinkPrice !== 0) {
    const diffUsd = binancePrice - chainlinkPrice;
    const diffPct = (diffUsd / chainlinkPrice) * 100;
    const sign = diffUsd > 0 ? '+' : diffUsd < 0 ? '-' : '';
    diffText = `${sign}$${Math.abs(diffUsd).toFixed(2)} (${sign}${Math.abs(diffPct).toFixed(2)}%)`;
  }

  const timeColor =
    timeLeftMin !== null
      ? timeLeftMin >= 10
        ? 'timer--safe'
        : timeLeftMin >= 5
          ? 'timer--warn'
          : 'timer--danger'
      : '';

  return (
    <div className="card span-2" style={{ animationDelay: '0.05s' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {/* Chainlink / Current price */}
        <div ref={priceRef}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              className={`status-dot ${chainlinkConnected ? '' : 'status-dot--warning'}`}
              style={{ width: 5, height: 5 }}
            />
            Current Price ({chainlinkSource || 'Chainlink'})
          </div>
          <div className={`price-big ${priceColor}`}>
            {displayPrice !== null ? `$${formatNumber(displayPrice, 2)}` : '-'}
            {arrow && <span className="price-arrow">{arrow}</span>}
          </div>
        </div>

        {/* Timer */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
            }}
          >
            ⏱ Time Left
          </div>
          <div className={`timer ${timeColor}`}>
            {timeLeftMin !== null ? fmtTimeLeft(timeLeftMin) : '--:--'}
          </div>
        </div>

        {/* Binance */}
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 6,
            }}
          >
            BTC Binance Spot
            <span
              className={`status-dot ${binanceConnected ? '' : 'status-dot--error'}`}
              style={{ width: 5, height: 5 }}
            />
          </div>
          <div className="price-mid" style={{ color: 'var(--text-primary)' }}>
            {binancePrice !== null ? `$${formatNumber(binancePrice, 2)}` : '-'}
          </div>
          {diffText && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {diffText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
