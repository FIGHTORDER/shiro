import React from "react";

/* A render error used to blank the window with no explanation. Show what broke
   instead - we are wiring live server data into screens built against demo
   data, so this will earn its keep. */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("Shiro render error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stack = (this.state.info && this.state.info.componentStack) || "";
    return (
      <div style={{ padding: "var(--sp-9)", display: "flex", flexDirection: "column",
        gap: "var(--sp-5)", height: "100%", overflowY: "auto", background: "var(--surface-base)" }}>
        <span style={{ font: "var(--text-title)", color: "var(--signal-danger)" }}>
          Something broke while rendering.
        </span>
        <span style={{ font: "var(--text-prose)", color: "var(--text-body)", maxWidth: "72ch" }}>
          {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
        </span>
        <pre style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-mono)",
          color: "var(--text-low)", background: "var(--surface-sunken)", padding: "var(--sp-5)",
          border: "1px solid var(--w-06)", whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {stack.trim().slice(0, 2000)}
        </pre>
        <button type="button" onClick={() => this.setState({ error: null, info: null })}
          style={{ alignSelf: "flex-start", font: "var(--text-ui)", padding: "var(--sp-4) var(--sp-6)",
            background: "var(--surface-inverse)", color: "var(--text-inverse)", border: 0, cursor: "pointer" }}>
          Try again
        </button>
      </div>
    );
  }
}
