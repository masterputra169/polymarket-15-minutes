import React, { useMemo } from 'react';
import { useBinanceStream } from './hooks/useBinanceStream.js';
import { usePolymarketChainlinkStream } from './hooks/usePolymarketChainlinkStream.js';
import { useChainlinkWssStream } from './hooks/useChainlinkWssStream.js';
import { useMarketData } from './hooks/useMarketData.js';
import CurrentPriceCard from './components/CurrentPriceCard.jsx';
import TAIndicators from './components/TAIndicators.jsx';
import PredictPanel from './components/PredictPanel.jsx';
import PolymarketPanel from './components/PolymarketPanel.jsx';
import EdgePanel from './components/EdgePanel.jsx';
import SessionInfo from './components/SessionInfo.jsx';

function StatusDot({ connected, label }) {
  const cls = connected ? '' : 'status-dot--error';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className={`status-dot ${cls}`} style={{ width: 5, height: 5 }} />
      <span>{label}</span>
    </span>
  );
}

export default function App() {
  // Data sources
  const binance = useBinanceStream();
  const polymarketWs = usePolymarketChainlinkStream();
  const chainlinkWss = useChainlinkWssStream();
  const { data, loading, error } = useMarketData();

  // Chainlink price priority: Polymarket WS > Chainlink WSS > Chainlink HTTP RPC
  const chainlinkResolved = useMemo(() => {
    if (polymarketWs.price !== null) {
      return {
        price: polymarketWs.price,
        prevPrice: polymarketWs.prevPrice,
        connected: polymarketWs.connected,
        source: 'Polymarket WS',
      };
    }
    if (chainlinkWss.price !== null) {
      return {
        price: chainlinkWss.price,
        prevPrice: chainlinkWss.prevPrice,
        connected: chainlinkWss.connected,
        source: 'Chainlink WSS',
      };
    }
    if (data?.chainlinkRpc?.price !== null && data?.chainlinkRpc?.price !== undefined) {
      return {
        price: data.chainlinkRpc.price,
        prevPrice: null,
        connected: true,
        source: 'Chainlink RPC',
      };
    }
    return {
      price: null,
      prevPrice: null,
      connected: false,
      source: 'None',
    };
  }, [polymarketWs, chainlinkWss, data?.chainlinkRpc]);

  const chainlinkConnected =
    polymarketWs.connected || chainlinkWss.connected || (data?.chainlinkRpc?.price != null);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__title">
          <span className="btc-icon">₿</span>
          Polymarket BTC 15m Assistant
        </div>
        <div className="app-header__status">
          <StatusDot connected={binance.connected} label="Binance" />
          <span style={{ color: 'var(--text-dim)' }}>|</span>
          <StatusDot connected={chainlinkConnected} label={`Chainlink (${chainlinkResolved.source})`} />
          <span style={{ color: 'var(--text-dim)' }}>|</span>
          <StatusDot connected={!error} label="Data" />
        </div>
      </header>

      {/* Connection errors */}
      {error && (
        <div className="connection-banner connection-banner--error">
          ⚠ Data fetch error: {error}
        </div>
      )}

      {/* Chainlink fallback notice */}
      {!polymarketWs.connected && chainlinkResolved.source !== 'Polymarket WS' && chainlinkResolved.price !== null && (
        <div className="connection-banner connection-banner--warning">
          ⚠ Polymarket WS unavailable — using fallback: {chainlinkResolved.source}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="loading-screen">
          <div className="loading-screen__spinner" />
          <div className="loading-screen__text">Connecting to markets...</div>
        </div>
      )}

      {/* Dashboard Grid */}
      {data && (
        <div className="dashboard-grid">
          {/* Row 1: Price + Timer (full width) */}
          <CurrentPriceCard
            chainlinkPrice={chainlinkResolved.price}
            chainlinkPrevPrice={chainlinkResolved.prevPrice}
            chainlinkConnected={chainlinkConnected}
            chainlinkSource={chainlinkResolved.source}
            binancePrice={binance.price ?? data.lastPrice}
            binancePrevPrice={binance.prevPrice}
            binanceConnected={binance.connected}
            timeLeftMin={data.timeLeftMin}
          />

          {/* Row 2: Prediction + TA */}
          <PredictPanel data={data} />
          <TAIndicators data={data} />

          {/* Row 3: Polymarket + Edge */}
          <PolymarketPanel data={data} />
          <EdgePanel data={data} />

          {/* Row 4: Session (full width) */}
          <SessionInfo />
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        ⚠ Not financial advice. Use at your own risk. — created by @krajekis
      </footer>
    </div>
  );
}
