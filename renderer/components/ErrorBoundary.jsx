/**
 * @file ErrorBoundary.jsx
 * @description React class-based error boundary. Wraps the root app so that
 * uncaught render errors show a recovery UI instead of a blank white screen.
 * React error boundaries must be class components — hooks cannot catch
 * errors in the render phase of child components.
 */

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message ?? 'Unknown error' };
  }

  componentDidCatch(err, info) {
    // Log to main process if available so errors appear in the app log file
    if (window.electronAPI?.logError) {
      window.electronAPI.logError({ message: err.message, stack: err.stack, componentStack: info.componentStack });
    }
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // panel=true → scoped fallback that fits inside a panel without covering the sidebar/statusbar
    if (this.props.panel) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
          <p className="text-base font-semibold text-red-400">This panel crashed</p>
          <p className="text-xs text-fg-faint max-w-sm font-mono">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-1 px-4 py-1.5 rounded-md bg-card hover:bg-raise text-fg text-sm transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-canvas text-fg gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-red-400">Something went wrong</p>
        <p className="text-sm text-fg-dim max-w-md font-mono">{this.state.message}</p>
        <button
          onClick={this.handleReload}
          className="mt-2 px-4 py-2 rounded-md bg-accent hover:bg-accent/80 text-white text-sm transition-colors"
        >
          Reload app
        </button>
      </div>
    );
  }
}
