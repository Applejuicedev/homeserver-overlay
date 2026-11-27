import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useAgentSocket } from "./hooks/useAgentSocket";
import { useHistory } from "./hooks/useHistory";
import { useSettings, type Theme, type Thresholds } from "./hooks/useSettings";
import { useAlerts } from "./hooks/useAlerts";
import { useUpdater } from "./hooks/useUpdater";
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

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1e3) return `${(bytesPerSec / 1e3).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

type Level = "good" | "warn" | "crit";

function levelFor(value: number, warn: number, crit: number): Level {
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "good";
}

function colorForLevel(level: Level): string {
  return level === "crit" ? "var(--bad)" : level === "warn" ? "var(--warn)" : "var(--good)";
}

function colorFor(value: number, warn: number, crit: number): string {
  return colorForLevel(levelFor(value, warn, crit));
}

function diskLabel(mountPoint: string): string {
  if (mountPoint === "/") return "/";
  const parts = mountPoint.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? mountPoint;
}

const COMPACT_SIZE = { width: 210, height: 122 };
const EXPANDED_SIZE = { width: 460, height: 660 };

export default function App() {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem("agent_url") ?? "http://100.82.168.54:9090"
  );
  const [token, setToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    invoke<string | null>("load_token")
      .then((saved) => {
        if (saved) {
          setToken(saved);
        } else {
          setShowSettings(true);
        }
      })
      .catch(() => setShowSettings(true))
      .finally(() => setTokenLoaded(true));
  }, []);
  const [expanded, setExpanded] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);

  const { metrics, status } = useAgentSocket(serverUrl, token);
  const history = useHistory(serverUrl, token, 30);
  const { theme, setTheme, opacity, setOpacity, widgets, toggleWidget, thresholds, setThreshold } =
    useSettings();

  useAlerts(metrics, status, thresholds);
  const { update, installUpdate, installing } = useUpdater();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      listen("toggle-click-through", () => {
        setClickThrough((prev) => {
          const next = !prev;
          invoke("set_click_through", { enabled: next }).catch(() => {});
          return next;
        });
      })
        .then((f) => {
          unlisten = f;
        })
        .catch(() => {});
    } catch {
      // Tauri-Bridge noch nicht bereit - Hotkey-Events bleiben dann aus
    }
    return () => {
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const size = expanded ? EXPANDED_SIZE : COMPACT_SIZE;
    try {
      getCurrentWindow()
        .setSize(new LogicalSize(size.width, size.height))
        .catch((e) => console.error("setSize failed", e));
    } catch {
      // Tauri-Bridge noch nicht bereit - Fenstergroesse bleibt dann unveraendert
    }
  }, [expanded]);

  function saveSettings() {
    localStorage.setItem("agent_url", serverUrl);
    invoke("save_token", { token }).catch(() => {});
    setShowSettings(false);
  }

  const memPercent = metrics ? (metrics.mem_used_bytes / metrics.mem_total_bytes) * 100 : 0;
  const swapPercent =
    metrics && metrics.swap_total_bytes > 0 ? (metrics.swap_used_bytes / metrics.swap_total_bytes) * 100 : 0;
  const rootDisk = metrics?.disks.find((d) => d.mount_point === "/") ?? metrics?.disks[0];
  const rootDiskPercent = rootDisk
    ? ((rootDisk.total_bytes - rootDisk.available_bytes) / rootDisk.total_bytes) * 100
    : 0;
  const otherDisks = metrics?.disks.filter((d) => d !== rootDisk) ?? [];

  const levels: Level[] = [];
  if (metrics) {
    levels.push(levelFor(metrics.cpu_percent_total, 70, 90));
    levels.push(levelFor(memPercent, 70, 90));
    if (metrics.swap_total_bytes > 0) levels.push(levelFor(swapPercent, 50, 80));
    for (const d of metrics.disks) {
      const pct = ((d.total_bytes - d.available_bytes) / d.total_bytes) * 100;
      levels.push(levelFor(pct, thresholds.diskPercent - 15, thresholds.diskPercent));
    }
    if (metrics.cpu_temp_celsius != null) {
      levels.push(levelFor(metrics.cpu_temp_celsius, thresholds.cpuTempCelsius - 15, thresholds.cpuTempCelsius));
    }
    for (const c of metrics.containers) {
      if (c.state !== "running") levels.push("crit");
    }
    for (const s of metrics.smart) {
      if (!s.health_ok) levels.push("crit");
    }
  }
  const critCount = levels.filter((l) => l === "crit").length;
  const warnCount = levels.filter((l) => l === "warn").length;

  const statusColor =
    status === "connected" ? "var(--good)" : status === "connecting" ? "var(--warn)" : "var(--bad)";

  const cpuHistory = history.map((h) => h.cpu_percent_total);
  const memHistory = history.map((h) => (h.mem_used_bytes / h.mem_total_bytes) * 100);
  const diskHistory = history.map((h) => ((h.disk_total_bytes - h.disk_available_bytes) / h.disk_total_bytes) * 100);

  return (
    <div
      className={`overlay ${clickThrough ? "click-through" : ""}`}
      style={{ opacity }}
      title={!expanded ? "Strg+Alt+H: Klick-durch umschalten" : undefined}
    >
      <div className="titlebar" data-tauri-drag-region>
        <span
          className="status-dot"
          data-tauri-drag-region
          style={{ background: statusColor, color: statusColor }}
          title={
            status === "connected"
              ? critCount > 0
                ? `${critCount} Wert${critCount === 1 ? "" : "e"} kritisch`
                : warnCount > 0
                  ? `${warnCount} Wert${warnCount === 1 ? "" : "e"} im Warnbereich`
                  : "Alles okay"
              : undefined
          }
        />
        <span className="hostname" data-tauri-drag-region>{metrics?.hostname ?? "homeserver"}</span>
        <button
          className="icon-btn"
          onClick={() => invoke("open_terminal_window").catch(() => {})}
          title="SSH-Shell öffnen"
        >
          ⌨
        </button>
        <button className="icon-btn" onClick={() => setExpanded((e) => !e)} title="Dashboard ein-/ausklappen">
          {expanded ? "▾" : "▸"}
        </button>
        <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Einstellungen">
          ⚙
        </button>
      </div>

      {!tokenLoaded ? (
        <div className="offline">Lade…</div>
      ) : showSettings ? (
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
          updateVersion={update?.version ?? null}
          onInstallUpdate={installUpdate}
          installing={installing}
        />
      ) : metrics && !expanded ? (
        <MiniGaugeRow
          items={[
            {
              label: "CPU",
              value: `${metrics.cpu_percent_total.toFixed(0)}%`,
              percent: metrics.cpu_percent_total,
              color: colorFor(metrics.cpu_percent_total, 70, 90),
            },
            {
              label: "RAM",
              value: `${memPercent.toFixed(0)}%`,
              percent: memPercent,
              color: colorFor(memPercent, 70, 90),
            },
            {
              label: "Disk",
              value: `${rootDiskPercent.toFixed(0)}%`,
              percent: rootDiskPercent,
              color: colorFor(rootDiskPercent, thresholds.diskPercent - 15, thresholds.diskPercent),
            },
          ]}
        />
      ) : metrics ? (
        <div className="metrics">
          <div className="gauge-grid">
            <Gauge
              label="CPU"
              percent={metrics.cpu_percent_total}
              value={`${metrics.cpu_percent_total.toFixed(0)}%`}
              color={colorFor(metrics.cpu_percent_total, 70, 90)}
            />
            <Gauge
              label="RAM"
              percent={memPercent}
              value={`${memPercent.toFixed(0)}%`}
              color={colorFor(memPercent, 70, 90)}
            />
            {rootDisk && (
              <Gauge
                label="Disk"
                percent={rootDiskPercent}
                value={`${rootDiskPercent.toFixed(0)}%`}
                color={colorFor(rootDiskPercent, thresholds.diskPercent - 15, thresholds.diskPercent)}
              />
            )}
            {metrics.cpu_temp_celsius != null ? (
              <Gauge
                label="Temp"
                percent={metrics.cpu_temp_celsius}
                value={`${metrics.cpu_temp_celsius.toFixed(0)}°C`}
                color={colorFor(metrics.cpu_temp_celsius, thresholds.cpuTempCelsius - 15, thresholds.cpuTempCelsius)}
              />
            ) : (
              metrics.swap_total_bytes > 0 && (
                <Gauge
                  label="Swap"
                  percent={swapPercent}
                  value={`${swapPercent.toFixed(0)}%`}
                  color={colorFor(swapPercent, 50, 80)}
                />
              )
            )}
          </div>

          <div className="info-grid">
            <div className="info-cell">
              <span>Uptime</span>
              <span>{formatUptime(metrics.uptime_seconds)}</span>
            </div>
            <div className="info-cell">
              <span>Load</span>
              <span>{metrics.load_avg[0].toFixed(2)}</span>
            </div>
            <div className="info-cell">
              <span>↓ Netz</span>
              <span>{formatRate(metrics.network_rx_bytes_per_sec)}</span>
            </div>
            <div className="info-cell">
              <span>↑ Netz</span>
              <span>{formatRate(metrics.network_tx_bytes_per_sec)}</span>
            </div>
            {metrics.cpu_temp_celsius != null && metrics.swap_total_bytes > 0 && (
              <div className="info-cell">
                <span>Swap</span>
                <span style={{ color: colorFor(swapPercent, 50, 80) }}>
                  {formatBytesGB(metrics.swap_used_bytes)} / {formatBytesGB(metrics.swap_total_bytes)} GB
                </span>
              </div>
            )}
          </div>

          <>
              {otherDisks.length > 0 && (
                <div className="info-grid">
                  {otherDisks.map((d) => {
                    const pct = ((d.total_bytes - d.available_bytes) / d.total_bytes) * 100;
                    return (
                      <div className="info-cell" key={d.mount_point}>
                        <span>{diskLabel(d.mount_point)}</span>
                        <span style={{ color: colorFor(pct, thresholds.diskPercent - 15, thresholds.diskPercent) }}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {widgets.sparklines && (
                <>
                  <div className="section-title">Verlauf (30 Min)</div>
                  <div className="chart-grid">
                    <div className="chart-card">
                      <div className="chart-head">
                        <span>CPU</span>
                        <span style={{ color: colorFor(metrics.cpu_percent_total, 70, 90) }}>
                          {metrics.cpu_percent_total.toFixed(0)}%
                        </span>
                      </div>
                      <Sparkline values={cpuHistory} color={colorFor(metrics.cpu_percent_total, 70, 90)} height={26} />
                    </div>
                    <div className="chart-card">
                      <div className="chart-head">
                        <span>RAM</span>
                        <span style={{ color: colorFor(memPercent, 70, 90) }}>{memPercent.toFixed(0)}%</span>
                      </div>
                      <Sparkline values={memHistory} color={colorFor(memPercent, 70, 90)} height={26} />
                    </div>
                    <div className="chart-card">
                      <div className="chart-head">
                        <span>Disk</span>
                        <span style={{ color: colorFor(rootDiskPercent, thresholds.diskPercent - 15, thresholds.diskPercent) }}>
                          {rootDiskPercent.toFixed(0)}%
                        </span>
                      </div>
                      <Sparkline
                        values={diskHistory}
                        color={colorFor(rootDiskPercent, thresholds.diskPercent - 15, thresholds.diskPercent)}
                        height={26}
                      />
                    </div>
                  </div>
                </>
              )}

              {metrics.cpu_percent_per_core.length > 1 && (
                <div className="core-grid">
                  {metrics.cpu_percent_per_core.map((pct, i) => (
                    <div
                      key={i}
                      className="core-chip"
                      style={{ color: colorFor(pct, 70, 90), borderColor: colorFor(pct, 70, 90) }}
                    >
                      C{i} {pct.toFixed(0)}%
                    </div>
                  ))}
                </div>
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
                        <span
                          className="name"
                          style={{ flex: "none", color: colorFor(c.cpu_percent, 70, 90) }}
                        >
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
                          {s.temperature_celsius != null && (
                            <span style={{ color: colorFor(s.temperature_celsius, 45, 55) }}>
                              {" "}
                              · {s.temperature_celsius}°C
                            </span>
                          )}
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
        </div>
      ) : (
        <div className="offline">
          {status === "connecting" ? "Verbinde…" : "Keine Verbindung"}
        </div>
      )}

    </div>
  );
}

function Gauge({
  label,
  percent,
  value,
  color,
}: {
  label: string;
  percent: number;
  value: string;
  color: string;
}) {
  const size = 80;
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(percent, 100));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="gauge-card">
      <div className="gauge">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} className="gauge-track" strokeWidth={strokeWidth} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className="gauge-fill"
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="gauge-text">
          <div className="gauge-value">{value}</div>
          <div className="gauge-label">{label}</div>
        </div>
      </div>
    </div>
  );
}

function MiniGaugeRow({
  items,
}: {
  items: { label: string; value: string; percent: number; color: string }[];
}) {
  return (
    <div className="mini-gauge-row">
      {items.map((item) => (
        <MiniGauge key={item.label} {...item} />
      ))}
    </div>
  );
}

function MiniGauge({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
}) {
  const size = 40;
  const strokeWidth = 4;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(percent, 100));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="mini-gauge">
      <div className="gauge" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} className="gauge-track" strokeWidth={strokeWidth} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
      </div>
      <div className="mini-gauge-value" style={{ color }}>
        {value}
      </div>
      <div className="mini-gauge-label">{label}</div>
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
  updateVersion: string | null;
  onInstallUpdate: () => void;
  installing: boolean;
}

function SettingsPanel(props: SettingsPanelProps) {
  const {
    serverUrl, setServerUrl, token, setToken, onSave,
    theme, setTheme, opacity, setOpacity,
    widgets, toggleWidget, thresholds, setThreshold,
    updateVersion, onInstallUpdate, installing,
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

      {updateVersion && (
        <>
          <div className="section-title">Update</div>
          <div className="settings-row">
            <span>Version {updateVersion} verfügbar</span>
            <button onClick={onInstallUpdate} disabled={installing} style={{ margin: 0 }}>
              {installing ? "Installiere…" : "Installieren"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
