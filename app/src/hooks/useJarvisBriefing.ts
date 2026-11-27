import { useEffect, useState } from "react";

const JARVIS_URL = "http://100.82.168.54:8092";

export interface JarvisBriefing {
  shortSummary: string;
  hasIssues: boolean;
  issuesCount: number;
  reportMarkdown: string;
  loading: boolean;
  reachable: boolean;
}

export function useJarvisBriefing(intervalMs = 5 * 60_000): JarvisBriefing {
  const [data, setData] = useState<JarvisBriefing>({
    shortSummary: "Lade…",
    hasIssues: false,
    issuesCount: 0,
    reportMarkdown: "",
    loading: true,
    reachable: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchBriefing() {
      try {
        const res = await fetch(`${JARVIS_URL}/api/briefing`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) {
          setData({
            shortSummary: json.short_summary,
            hasIssues: json.has_issues,
            issuesCount: json.events_since_last_check?.length ?? 0,
            reportMarkdown: json.report_markdown,
            loading: false,
            reachable: true,
          });
        }
      } catch {
        if (!cancelled) {
          setData((d) => ({ ...d, loading: false, reachable: false }));
        }
      }
    }

    fetchBriefing();
    const id = setInterval(fetchBriefing, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return data;
}
