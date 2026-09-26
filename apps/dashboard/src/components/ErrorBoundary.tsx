import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps a rendering bug from blanking the console without saying so. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('RunbookAI console failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="state" role="alert">
        <p className="label">Display error</p>
        <h1 className="state__title">This view failed to render</h1>
        <p className="state__body">
          {this.state.error.message}. Nothing was sent to TrueForge; the run itself is unaffected.
        </p>
        <p>
          <button
            type="button"
            className="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </button>
        </p>
      </main>
    );
  }
}
