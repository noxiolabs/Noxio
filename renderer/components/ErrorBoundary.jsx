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

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0f0f11] text-zinc-100 gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-red-400">Something went wrong</p>
        <p className="text-sm text-zinc-500 max-w-md font-mono">{this.state.message}</p>
        <button
          onClick={this.handleReload}
          className="mt-2 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm transition-colors"
        >
          Reload app
        </button>
      </div>
    );
  }
}
