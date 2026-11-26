import { useEffect, useState } from "react";

export interface HistoryPoint {
  timestamp: number;
  cpu_percent_total: number;
  mem_used_bytes: number;
  mem_total_bytes: number;
  disk_available_bytes: number;
  disk_total_bytes: number;
}

export function useHistory(
  serverUrl: string,
  token: string,
  minutes: number,
  refreshMs = 30000
) {
  const [points, setPoints] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    if (!serverUrl || !token) return;
    let stopped = false;

    async function fetchHistory() {
      try {
        const httpUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
        const res = await fetch(
          `${httpUrl.replace(/\/+$/, "")}/api/history?minutes=${minutes}&token=${encodeURIComponent(token)}`
        );
        if (res.ok && !stopped) {
          setPoints(await res.json());
        }
      } catch {
        // Historie ist nicht kritisch, Fehler einfach ignorieren
      }
    }

    fetchHistory();
    const id = setInterval(fetchHistory, refreshMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [serverUrl, token, minutes, refreshMs]);

  return points;
}
