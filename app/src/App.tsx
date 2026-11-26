import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAgentSocket } from "./hooks/useAgentSocket";
import "./App.css";

function formatBytesGB(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem("agent_url") ?? "http://100.82.168.54:9090"
  );
  const [token, setToken] = useState(() => localStorage.getItem("agent_token") ?? "");
  const [showSettings, setShowSettings] = useState(!token);
  const [clickThrough, setClickThrough] = useState(false);

  const { metrics, status } = useAgentSocket(serverUrl, token);

  useEffect(() => {
    const unlisten = listen("toggle-click-through", () => {
      setClickThrough((prev) => {
        const next = !prev;
        invoke("set_click_through", { enabled: next }).catch(() => {});
        return next;
      });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  function saveSettings() {
    localStorage.setItem("agent_url", serverUrl);
    localStorage.setItem("agent_token", token);
    setShowSettings(false);
  }

  const disk = metrics?.disks?.[0];
  const memPercent = metrics ? (metrics.mem_used_bytes / metrics.mem_total_bytes) * 100 : 0;
  const diskPercent = disk ? ((disk.total_bytes - disk.available_bytes) / disk.total_bytes) * 100 : 0;

  const statusColor =
    status === "connected" ? "#3fb950" : status === "connecting" ? "#d29922" : "#e5534b";

  return (
    <div className={`overlay ${clickThrough ? "click-through" : ""}`}>
      <div className="titlebar" data-tauri-drag-region>
        <span className="status-dot" style={{ background: statusColor }} />
        <span className="hostname">{metrics?.hostname ?? "homeserver"}</span>
        <button className="settings-btn" onClick={() => setShowSettings((s) => !s)}>
          ⚙
        </button>
      </div>

      {showSettings ? (
        <div className="settings">
          <label>Server-URL</label>
          <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          <label>Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token vom Agent"
          />
          <button onClick={saveSettings}>Speichern</button>
        </div>
      ) : metrics ? (
        <div className="metrics">
          <Row label="CPU" percent={metrics.cpu_percent_total} value={`${metrics.cpu_percent_total.toFixed(0)}%`} />
          <Row
            label="RAM"
            percent={memPercent}
            value={`${formatBytesGB(metrics.mem_used_bytes)} / ${formatBytesGB(metrics.mem_total_bytes)} GB`}
          />
          {disk && (
            <Row
              label="Disk"
              percent={diskPercent}
              value={`${formatBytesGB(disk.total_bytes - disk.available_bytes)} / ${formatBytesGB(disk.total_bytes)} GB`}
            />
          )}
          <div className="footer-row">
            <span>Uptime {formatUptime(metrics.uptime_seconds)}</span>
            <span>Load {metrics.load_avg[0].toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="offline">
          {status === "connecting" ? "Verbinde…" : "Keine Verbindung"}
        </div>
      )}

      <div className="hint">Strg+Alt+H: Klick-durch umschalten</div>
    </div>
  );
}

function Row({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <div className="metric-row">
      <div className="metric-head">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}
