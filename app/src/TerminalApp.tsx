import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function TerminalApp() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#13161b",
        foreground: "#d6dde6",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    invoke("ssh_spawn").catch((e) => {
      term.writeln(`\r\n[Fehler beim Starten von SSH: ${e}]`);
    });

    const unlistenOutput = listen<string>("ssh-output", (event) => {
      term.write(event.payload);
    });
    const unlistenExit = listen("ssh-exit", () => {
      term.writeln("\r\n[Verbindung beendet]");
    });

    const dataDisposable = term.onData((data) => {
      invoke("ssh_write", { data }).catch(() => {});
    });

    function sendResize() {
      fitAddon.fit();
      invoke("ssh_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
    }
    const resizeObserver = new ResizeObserver(sendResize);
    resizeObserver.observe(containerRef.current);
    sendResize();

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      unlistenOutput.then((f) => f());
      unlistenExit.then((f) => f());
      invoke("ssh_kill").catch(() => {});
      term.dispose();
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#13161b",
        boxSizing: "border-box",
        padding: 8,
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
