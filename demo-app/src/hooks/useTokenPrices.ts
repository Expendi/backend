import { useState, useCallback, useEffect } from "react";
import { useApi } from "./useApi";

export interface TokenPrices {
  [symbol: string]: { usd: number; change24h: number };
}

const POLL_INTERVAL_MS = 60_000; // 60 seconds

export function useTokenPrices() {
  const { request } = useApi();
  const [prices, setPrices] = useState<TokenPrices>({});
  const [loading, setLoading] = useState(true);

  const fetchPrices = useCallback(async () => {
    try {
      const data = await request<TokenPrices>("/tokens/prices");
      setPrices(data);
    } catch {
      // Silent — prices just stay stale
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  return { prices, loading };
}
