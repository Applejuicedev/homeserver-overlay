import { useEffect, useRef, useState } from "react";

export interface DiskInfo {
  mount_point: string;
  total_bytes: number;
  available_bytes: number;
}

export interface ContainerInfo {
  name: string;
  state: string;
  status: string;
  cpu_percent: number;
  mem_usage: string;
}

export interface SmartInfo {
  device: string;
  health_ok: boolean;
  temperature_celsius: number | null;
}

export interface Metrics {
  timestamp: number;
  hostname: string;
  cpu_percent_total: number;
  cpu_percent_per_core: number[];
  load_avg: [number, number, number];
  mem_total_bytes: number;
  mem_used_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  disks: DiskInfo[];
  uptime_seconds: number;
  containers: ContainerInfo[];
  smart: SmartInfo[];
  cpu_temp_celsius: number | null;
  network_rx_bytes_per_sec: number;
  network_tx_bytes_per_sec: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

const MAX_BACKOFF_MS = 30000;

export function useAgentSocket(serverUrl: string, token: string) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!serverUrl || !token) {
      setStatus("disconnected");
      return;
    }

    let stopped = false;

    function connect() {
      if (stopped) return;
      setStatus("connecting");

      let wsUrl: string;
      try {
        const httpUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
        wsUrl = httpUrl.replace(/^http/, "ws").replace(/\/+$/, "") + `/ws?token=${encodeURIComponent(token)}`;
      } catch {
        setStatus("disconnected");
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus("connected");
      };

      ws.onmessage = (ev) => {
        try {
          setMetrics(JSON.parse(ev.data));
        } catch {
          // Nachricht ignorieren, wenn sie nicht parsebar ist
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function scheduleReconnect() {
      const delay = Math.min(1000 * 2 ** retryRef.current, MAX_BACKOFF_MS);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [serverUrl, token]);

  return { metrics, status };
}
