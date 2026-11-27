import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TerminalApp from "./TerminalApp";

const isTerminalWindow = new URLSearchParams(window.location.search).get("window") === "terminal";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTerminalWindow ? <TerminalApp /> : <App />}
  </React.StrictMode>,
);
