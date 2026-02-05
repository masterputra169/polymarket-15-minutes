import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../config.js';
import { toNumber } from '../utils.js';

/**
 * Real-time Polymarket CLOB WebSocket stream.
 * Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market
 * and subscribes to orderbook updates, price changes, and last trade prices.
 *
 * No authentication required for market channel.
 */

function parsePriceLevel(level) {
  if (!level) return null;
  return {
    price: toNumber(level.price),
    size: toNumber(level.size),
  };
}

function bestFromLevels(levels, side) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const parsed = levels.map(parsePriceLevel).filter((l) => l && l.price !== null);
  if (parsed.length === 0) return null;
  if (side === 'bid') return Math.max(...parsed.map((l) => l.price));
  return Math.min(...parsed.map((l) => l.price));
}

function summarizeLevels(levels, depth = 5) {
  if (!Array.isArray(levels)) return { best: null, liquidity: 0 };
  const parsed = levels.slice(0, depth).map(parsePriceLevel).filter(Boolean);
  const liquidity = parsed.reduce((acc, l) => acc + (l.size ?? 0), 0);
  return { liquidity };
}

export function usePolymarketClobStream() {
  // State
  const [upPrice, setUpPrice] = useState(null);
  const [downPrice, setDownPrice] = useState(null);
  const [upPrevPrice, setUpPrevPrice] = useState(null);
  const [downPrevPrice, setDownPrevPrice] = useState(null);
  const [orderbook, setOrderbook] = useState({
    up: { bestBid: null, bestAsk: null, spread: null, bidLiquidity: 0, askLiquidity: 0 },
    down: { bestBid: null, bestAsk: null, spread: null, bidLiquidity: 0, askLiquidity: 0 },
  });
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Refs
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectMsRef = useRef(500);
  const pingIntervalRef = useRef(null);
  const tokenIdsRef = useRef({ up: null, down: null });
  const subscribedRef = useRef(false);

  // Set token IDs from outside (called when market is discovered via REST)
  const setTokenIds = useCallback((upTokenId, downTokenId) => {
    const changed =
      tokenIdsRef.current.up !== upTokenId || tokenIdsRef.current.down !== downTokenId;
    tokenIdsRef.current = { up: upTokenId, down: downTokenId };

    if (changed && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      subscribe(wsRef.current);
    }
  }, []);

  function subscribe(ws) {
    const { up, down } = tokenIdsRef.current;
    if (!up && !down) return;

    const assetIds = [up, down].filter(Boolean);
    try {
      ws.send(
        JSON.stringify({
          assets_ids: assetIds,
          type: 'market',
        })
      );
      subscribedRef.current = true;
    } catch {
      /* ignore */
    }
  }

  function startPing(ws) {
    stopPing();
    pingIntervalRef.current = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send('PING');
        } catch {
          /* ignore */
        }
      }
    }, CONFIG.polymarket.clobPingIntervalMs || 10_000);
  }

  function stopPing() {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }

  function handleBookEvent(data) {
    const assetId = data.asset_id;
    const { up, down } = tokenIdsRef.current;

    const bids = Array.isArray(data.bids) ? data.bids : [];
    const asks = Array.isArray(data.asks) ? data.asks : [];

    const bestBid = bestFromLevels(bids, 'bid');
    const bestAsk = bestFromLevels(asks, 'ask');
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    const bidSummary = summarizeLevels(bids);
    const askSummary = summarizeLevels(asks);

    const bookData = {
      bestBid,
      bestAsk,
      spread,
      bidLiquidity: bidSummary.liquidity,
      askLiquidity: askSummary.liquidity,
    };

    if (assetId === up) {
      setOrderbook((prev) => ({ ...prev, up: bookData }));
      if (bestBid !== null && bestAsk !== null) {
        const mid = (bestBid + bestAsk) / 2;
        setUpPrice((prev) => {
          setUpPrevPrice(prev);
          return mid;
        });
      }
    } else if (assetId === down) {
      setOrderbook((prev) => ({ ...prev, down: bookData }));
      if (bestBid !== null && bestAsk !== null) {
        const mid = (bestBid + bestAsk) / 2;
        setDownPrice((prev) => {
          setDownPrevPrice(prev);
          return mid;
        });
      }
    }

    setLastUpdate(Date.now());
  }

  function handlePriceChange(data) {
    const changes = Array.isArray(data.price_changes) ? data.price_changes : [];
    const { up, down } = tokenIdsRef.current;

    for (const change of changes) {
      const assetId = change.asset_id;
      const bestBid = toNumber(change.best_bid);
      const bestAsk = toNumber(change.best_ask);

      if (bestBid !== null && bestAsk !== null) {
        const mid = (bestBid + bestAsk) / 2;

        if (assetId === up) {
          setUpPrice((prev) => {
            setUpPrevPrice(prev);
            return mid;
          });
          setOrderbook((prev) => ({
            ...prev,
            up: {
              ...prev.up,
              bestBid,
              bestAsk,
              spread: bestAsk - bestBid,
            },
          }));
        } else if (assetId === down) {
          setDownPrice((prev) => {
            setDownPrevPrice(prev);
            return mid;
          });
          setOrderbook((prev) => ({
            ...prev,
            down: {
              ...prev.down,
              bestBid,
              bestAsk,
              spread: bestAsk - bestBid,
            },
          }));
        }
      }
    }

    setLastUpdate(Date.now());
  }

  function handleLastTradePrice(data) {
    const assetId = data.asset_id;
    const price = toNumber(data.price);
    const { up, down } = tokenIdsRef.current;

    if (price === null) return;

    if (assetId === up) {
      setUpPrice((prev) => {
        setUpPrevPrice(prev);
        return price;
      });
    } else if (assetId === down) {
      setDownPrice((prev) => {
        setDownPrevPrice(prev);
        return price;
      });
    }

    setLastUpdate(Date.now());
  }

  const connect = useCallback(() => {
    const url = CONFIG.polymarket.clobWsUrl;
    if (!url) return;

    if (wsRef.current && wsRef.current.readyState <= 1) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      subscribedRef.current = false;

      ws.onopen = () => {
        setConnected(true);
        reconnectMsRef.current = 500;
        startPing(ws);

        // Subscribe if we already have token IDs
        if (tokenIdsRef.current.up || tokenIdsRef.current.down) {
          subscribe(ws);
        }
      };

      ws.onmessage = (evt) => {
        try {
          const raw = evt.data;
          if (typeof raw === 'string' && (raw === 'PONG' || raw === '')) return;

          const msg = JSON.parse(raw);
          const eventType = msg.event_type;

          switch (eventType) {
            case 'book':
              handleBookEvent(msg);
              break;
            case 'price_change':
              handlePriceChange(msg);
              break;
            case 'last_trade_price':
              handleLastTradePrice(msg);
              break;
            default:
              break;
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        subscribedRef.current = false;
        stopPing();
        const wait = reconnectMsRef.current;
        reconnectMsRef.current = Math.min(15000, Math.floor(wait * 1.5));
        reconnectRef.current = setTimeout(connect, wait);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      const wait = reconnectMsRef.current;
      reconnectMsRef.current = Math.min(15000, Math.floor(wait * 1.5));
      reconnectRef.current = setTimeout(connect, wait);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      stopPing();
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [connect]);

  return {
    upPrice,
    downPrice,
    upPrevPrice,
    downPrevPrice,
    orderbook,
    connected,
    lastUpdate,
    setTokenIds,
  };
}