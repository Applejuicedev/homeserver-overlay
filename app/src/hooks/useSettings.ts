import { useEffect, useState } from "react";

export type Theme = "system" | "dark" | "light";

export interface WidgetVisibility {
  sparklines: boolean;
  containers: boolean;
  smart: boolean;
}

export interface Thresholds {
  cpuTempCelsius: number;
  diskPercent: number;
}

const DEFAULT_WIDGETS: WidgetVisibility = {
  sparklines: true,
  containers: true,
  smart: true,
};

const DEFAULT_THRESHOLDS: Thresholds = {
  cpuTempCelsius: 80,
  diskPercent: 90,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function useSettings() {
  const [theme, setTheme] = useState<Theme>(() => load("ui_theme", "system" as Theme));
  const [opacity, setOpacity] = useState<number>(() => load("ui_opacity", 1));
  const [widgets, setWidgets] = useState<WidgetVisibility>(() =>
    load("ui_widgets", DEFAULT_WIDGETS)
  );
  const [thresholds, setThresholds] = useState<Thresholds>(() =>
    load("ui_thresholds", DEFAULT_THRESHOLDS)
  );

  useEffect(() => {
    localStorage.setItem("ui_theme", JSON.stringify(theme));
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ui_opacity", JSON.stringify(opacity));
  }, [opacity]);

  useEffect(() => {
    localStorage.setItem("ui_widgets", JSON.stringify(widgets));
  }, [widgets]);

  useEffect(() => {
    localStorage.setItem("ui_thresholds", JSON.stringify(thresholds));
  }, [thresholds]);

  function toggleWidget(key: keyof WidgetVisibility) {
    setWidgets((w) => ({ ...w, [key]: !w[key] }));
  }

  function setThreshold(key: keyof Thresholds, value: number) {
    setThresholds((t) => ({ ...t, [key]: value }));
  }

  return {
    theme,
    setTheme,
    opacity,
    setOpacity,
    widgets,
    toggleWidget,
    thresholds,
    setThreshold,
  };
}
