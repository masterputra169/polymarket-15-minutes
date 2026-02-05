import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../config.js';

/**
 * Chainlink BTC/USD price via Polygon WSS (AnswerUpdated log subscription).
 * Port of src/data/chainlinkWs.js from the original Node.js project.
 */

// keccak256("AnswerUpdated(int256,uint256,uint256)")
const ANSWER_UPDATED_TOPIC0 =
  '0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f';

function hexToSignedBigInt(hex) {
  const x = BigInt(hex);
  const TWO_255 = 1n << 255n;
  const TWO_256 = 1n << 256n;
  return x >= TWO_255 ? x - TWO_256 : x;
}

export function useChainlinkWssStream() {
  const [price, setPrice] = useState(null);
  const [prevPrice, setPrevPrice] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectMsRef = useRef(500);
  const urlIndexRef = useRef(0);
  const subIdRef = useRef(null);
  const nextIdRef = useRef(1);

  const getWssUrls = useCallback(() => {
    return CONFIG.chainlink?.polygonWssUrls ?? [];
  }, []);

  const connect = useCallback(() => {
    const wssUrls = getWssUrls();
    if (!wssUrls.length) return;

    const aggregator = CONFIG.chainlink?.btcUsdAggregator;
    const decimals = CONFIG.chainlink?.decimals ?? 8;
    if (!aggregator) return;

    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const url = wssUrls[urlIndexRef.current % wssUrls.length];
    urlIndexRef.current += 1;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      subIdRef.current = null;

      ws.onopen = () => {
        setConnected(true);
        reconnectMsRef.current = 500;

        const id = nextIdRef.current++;
        try {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              method: 'eth_subscribe',
              params: [
                'logs',
                {
                  address: aggregator,
                  topics: [ANSWER_UPDATED_TOPIC0],
                },
              ],
            })
          );
        } catch {
          /* ignore */
        }
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          // Subscription confirmation
          if (msg.id && msg.result && typeof msg.result === 'string' && !subIdRef.current) {
            subIdRef.current = msg.result;
            return;
          }

          if (msg.method !== 'eth_subscription') return;
          const params = msg.params;
          if (!params || !params.result) return;

          const log = params.result;
          const topics = Array.isArray(log.topics) ? log.topics : [];
          if (topics.length < 2) return;

          const answer = hexToSignedBigInt(topics[1]);
          const p = Number(answer) / 10 ** decimals;

          if (Number.isFinite(p)) {
            setPrice((prev) => {
              setPrevPrice(prev);
              return p;
            });
          }
        } catch {
          /* ignore */
        }
      };

      const scheduleReconnect = () => {
        setConnected(false);
        wsRef.current = null;
        subIdRef.current = null;
        const wait = reconnectMsRef.current;
        reconnectMsRef.current = Math.min(10000, Math.floor(wait * 1.5));
        reconnectRef.current = setTimeout(connect, wait);
      };

      ws.onclose = scheduleReconnect;
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      const wait = reconnectMsRef.current;
      reconnectMsRef.current = Math.min(10000, Math.floor(wait * 1.5));
      reconnectRef.current = setTimeout(connect, wait);
    }
  }, [getWssUrls]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [connect]);

  return { price, prevPrice, connected };
}
