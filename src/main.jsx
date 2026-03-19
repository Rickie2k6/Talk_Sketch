import React from "react";
import ReactDOM from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import App from "./App";

class FatalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("Talk Sketch failed to render.", error);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          padding: "24px",
          background: "#eef1f7",
          color: "#1f2a44",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: "22px" }}>Talk Sketch failed to load</h1>
        <p style={{ maxWidth: "720px", lineHeight: 1.5 }}>
          The app hit a browser-side error before it could render. The details are shown below so we can debug
          the exact issue.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "#fff",
            border: "1px solid #d7def0",
            borderRadius: "12px",
            padding: "16px",
            overflow: "auto",
          }}
        >
          {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
        </pre>
      </div>
    );
  }
}

const rootElement = document.getElementById("root");

window.addEventListener("error", (event) => {
  console.error("Uncaught window error:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
});

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <FatalErrorBoundary>
      <App />
    </FatalErrorBoundary>
  </React.StrictMode>,
);
