import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import HomePage from "./HomePage";

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
          The app hit a browser-side error before it could render. Check the browser console for details and reload
          the page after the latest frontend restart.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #c7d2ea",
            background: "#fff",
            color: "#1f2a44",
            cursor: "pointer",
          }}
        >
          Reload App
        </button>
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
  <FatalErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<App />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  </FatalErrorBoundary>,
);
