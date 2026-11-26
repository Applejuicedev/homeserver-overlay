import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useAgentSocket } from "./hooks/useAgentSocket";
import { useHistory } from "./hooks/useHistory";
import { useSettings, type Theme, type Thresholds } from "./hooks/useSettings";
import { useAlerts } from "./hooks/useAlerts";
import { Sparkline } from "./components/Sparkline";
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

const COMPACT_SIZE = { width: 300, height: 190 };
const EXPANDED_SIZE = { width: 420, height: 560 };

export default function App() {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem("agent_url") ?? "http://100.82.168.54:9090"
  );
  const [token, setToken] = useState(() => localStorage.getItem("agent_token") ?? "");
  const [showSettings, setShowSettings] = useState(!token);
  const [expanded, setExpanded] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);

  const { metrics, status } = useAgentSocket(serverUrl, token);
  const history = useHistory(serverUrl, token, 30);
  const { theme, setTheme, opacity, setOpacity, widgets, toggleWidget, thresholds, setThreshold } =
    useSettings();

  useAlerts(metrics, status, thresholds);

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

  useEffect(() => {
    const size = expanded ? EXPANDED_SIZE : COMPACT_SIZE;
    getCurrentWindow()
      .setSize(new LogicalSize(size.width, size.height))
      .catch(() => {});
  }, [expanded]);

  function saveSettings() {
    localStorage.setItem("agent_url", serverUrl);
    localStorage.setItem("agent_token", token);
    setShowSettings(false);
  }

  const disk = metrics?.disks?.[0];
  const memPercent = metrics ? (metrics.mem_used_bytes / metrics.mem_total_bytes) * 100 : 0;
  const diskPercent = disk ? ((disk.total_bytes - disk.available_bytes) / disk.total_bytes) * 100 : 0;

  const statusColor =
    status === "connected" ? "var(--good)" : status === "connecting" ? "var(--warn)" : "var(--bad)";

  const cpuHistory = history.map((h) => h.cpu_percent_total);
  const memHistory = history.map((h) => (h.mem_used_bytes / h.mem_total_bytes) * 100);
  const diskHistory = history.map((h) => ((h.disk_total_bytes - h.disk_available_bytes) / h.disk_total_bytes) * 100);

  return (
    <div
      className={`overlay ${clickThrough ? "click-through" : ""}`}
      style={{ opacity }}
    >
      <div className="titlebar" data-tauri-drag-region>
        <span className="status-dot" style={{ background: statusColor, color: statusColor }} />
        <span className="hostname">{metrics?.hostname ?? "homeserver"}</span>
        <button className="icon-btn" onClick={() => setExpanded((e) => !e)} title="Dashboard ein-/ausklappen">
          {expanded ? "▾" : "▸"}
        </button>
        <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Einstellungen">
          ⚙
        </button>
      </div>

      {showSettings ? (
        <SettingsPanel
          serverUrl={serverUrl}
          setServerUrl={setServerUrl}
          token={token}
          setToken={setToken}
          onSave={saveSettings}
          theme={theme}
          setTheme={setTheme}
          opacity={opacity}
          setOpacity={setOpacity}
          widgets={widgets}
          toggleWidget={toggleWidget}
          thresholds={thresholds}
          setThreshold={setThreshold}
        />
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
            <span>
              Load {metrics.load_avg[0].toFixed(2)}
              {metrics.cpu_temp_celsius != null ? ` · ${metrics.cpu_temp_celsius.toFixed(0)}°C` : ""}
            </span>
          </div>

          {expanded && (
            <>
              {widgets.sparklines && (
                <>
                  <div className="section-title">Verlauf (30 Min)</div>
                  <div className="sparkline-row">
                    <Sparkline values={cpuHistory} color="#5b8def" />
                  </div>
                  <div className="sparkline-row">
                    <Sparkline values={memHistory} color="#3fb950" />
                  </div>
                  <div className="sparkline-row">
                    <Sparkline values={diskHistory} color="#d29922" />
                  </div>
                </>
              )}

              {widgets.containers && (
                <>
                  <div className="section-title">Docker-Container</div>
                  <div className="container-list">
                    {metrics.containers.length === 0 && (
                      <div className="empty-hint">Keine Container gefunden</div>
                    )}
                    {metrics.containers.map((c) => (
                      <div className="container-item" key={c.name}>
                        <span className="name">{c.name}</span>
                        <span className="name" style={{ flex: "none", opacity: 0.7 }}>
                          {c.cpu_percent.toFixed(1)}%
                        </span>
                        <span className={`badge ${c.state === "running" ? "up" : "down"}`}>
                          {c.state === "running" ? "läuft" : c.state}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {widgets.smart && (
                <>
                  <div className="section-title">Festplatten-Gesundheit</div>
                  <div className="smart-list">
                    {metrics.smart.length === 0 && (
                      <div className="empty-hint">Keine SMART-Daten verfügbar</div>
                    )}
                    {metrics.smart.map((s) => (
                      <div className="smart-item" key={s.device}>
                        <span className="name">
                          {s.device}
                          {s.temperature_celsius != null ? ` · ${s.temperature_celsius}°C` : ""}
                        </span>
                        <span className={`badge ${s.health_ok ? "up" : "down"}`}>
                          {s.health_ok ? "OK" : "FEHLER"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
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

interface SettingsPanelProps {
  serverUrl: string;
  setServerUrl: (v: string) => void;
  token: string;
  setToken: (v: string) => void;
  onSave: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  opacity: number;
  setOpacity: (o: number) => void;
  widgets: { sparklines: boolean; containers: boolean; smart: boolean };
  toggleWidget: (k: "sparklines" | "containers" | "smart") => void;
  thresholds: Thresholds;
  setThreshold: (k: keyof Thresholds, v: number) => void;
}

function SettingsPanel(props: SettingsPanelProps) {
  const {
    serverUrl, setServerUrl, token, setToken, onSave,
    theme, setTheme, opacity, setOpacity,
    widgets, toggleWidget, thresholds, setThreshold,
  } = props;

  return (
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
      <button onClick={onSave}>Speichern</button>

      <div className="section-title">Darstellung</div>
      <div className="settings-row">
        <span>Theme</span>
        <div className="theme-switch">
          {(["system", "dark", "light"] as Theme[]).map((t) => (
            <button
              key={t}
              className={theme === t ? "active" : ""}
              onClick={() => setTheme(t)}
            >
              {t === "system" ? "Auto" : t === "dark" ? "Dunkel" : "Hell"}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span>Deckkraft</span>
        <input
          type="range"
          min="0.3"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => setOpacity(parseFloat(e.target.value))}
        />
      </div>

      <div className="section-title">Widgets (Dashboard-Ansicht)</div>
      <div className="settings-row">
        <span>Verlaufs-Grafiken</span>
        <input type="checkbox" checked={widgets.sparklines} onChange={() => toggleWidget("sparklines")} />
      </div>
      <div className="settings-row">
        <span>Docker-Container</span>
        <input type="checkbox" checked={widgets.containers} onChange={() => toggleWidget("containers")} />
      </div>
      <div className="settings-row">
        <span>Festplatten-Gesundheit</span>
        <input type="checkbox" checked={widgets.smart} onChange={() => toggleWidget("smart")} />
      </div>

      <div className="section-title">Alarm-Schwellwerte</div>
      <div className="settings-row">
        <span>CPU-Temperatur &gt;</span>
        <input
          type="number"
          style={{ width: 50 }}
          value={thresholds.cpuTempCelsius}
          onChange={(e) => setThreshold("cpuTempCelsius", Number(e.target.value))}
        />
        <span>°C</span>
      </div>
      <div className="settings-row">
        <span>Speicher belegt &gt;</span>
        <input
          type="number"
          style={{ width: 50 }}
          value={thresholds.diskPercent}
          onChange={(e) => setThreshold("diskPercent", Number(e.target.value))}
        />
        <span>%</span>
      </div>
    </div>
  );
}
