import { Component, type ErrorInfo, type ReactNode } from 'react';
import { secondaryButton } from '../styles';

interface State {
  failed: boolean;
}

/**
 * Keeps a fault in the analytics from taking the rest of the app down. Study
 * modes, cards and progress keep working; only this page says it could not be
 * drawn. Nothing about the user's data is logged.
 */
export default class AnalyticsErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    void info;
    console.error('Snap Notes analytics failed:', error instanceof Error ? error.name : 'error');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-900">Analytics could not be shown</h2>
        <p className="mt-1 text-sm text-red-800">
          Something went wrong while working out your statistics. Your cards, progress and study
          history are safe, and every study mode still works.
        </p>
        <button
          type="button"
          className={`${secondaryButton} mt-4`}
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </button>
      </div>
    );
  }
}
