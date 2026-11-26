import { useEffect, useRef } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Metrics, ConnectionStatus } from "./useAgentSocket";
import type { Thresholds } from "./useSettings";

const OFFLINE_GRACE_MS = 10000;

export function useAlerts(metrics: Metrics | null, status: ConnectionStatus, thresholds: Thresholds) {
  const alertState = useRef<Record<string, boolean>>({});
  const permissionGranted = useRef(false);

  useEffect(() => {
    (async () => {
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === "granted";
      }
      permissionGranted.current = granted;
    })();
  }, []);

  function fire(key: string, active: boolean, title: string, body: string) {
    const was = alertState.current[key] ?? false;
    if (active && !was) {
      alertState.current[key] = true;
      if (permissionGranted.current) {
        sendNotification({ title, body });
      }
    } else if (!active && was) {
      alertState.current[key] = false;
    }
  }

  // Server nicht erreichbar (mit Gnadenfrist gegen Flapping bei normalen Reconnects)
  useEffect(() => {
    if (status !== "disconnected") {
      fire("offline", false, "", "");
      return;
    }
    const timer = setTimeout(() => {
      fire(
        "offline",
        true,
        "Homeserver nicht erreichbar",
        "Die Verbindung zum Agent ist seit mehr als 10 Sekunden unterbrochen."
      );
    }, OFFLINE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Metrik-basierte Schwellwerte
  useEffect(() => {
    if (!metrics) return;

    if (metrics.cpu_temp_celsius != null) {
      fire(
        "cpu_temp",
        metrics.cpu_temp_celsius > thresholds.cpuTempCelsius,
        "CPU-Temperatur hoch",
        `${metrics.cpu_temp_celsius.toFixed(0)}°C überschreitet den Schwellwert von ${thresholds.cpuTempCelsius}°C.`
      );
    }

    const disk = metrics.disks[0];
    if (disk) {
      const percent = ((disk.total_bytes - disk.available_bytes) / disk.total_bytes) * 100;
      fire(
        "disk",
        percent > thresholds.diskPercent,
        "Speicherplatz knapp",
        `Festplatte ist zu ${percent.toFixed(0)}% belegt.`
      );
    }

    for (const c of metrics.containers) {
      const key = `container_${c.name}`;
      fire(key, c.state !== "running", "Container gestoppt", `${c.name} läuft nicht (Status: ${c.state}).`);
    }
  }, [metrics, thresholds]);
}
