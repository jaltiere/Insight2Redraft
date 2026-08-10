import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
          <h1 className="text-xl font-semibold">Something went wrong.</h1>
          <p className="text-sm text-muted-foreground">An unexpected error occurred.</p>
          <a href="/" className="text-sm font-medium text-primary hover:underline">
            Go home
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}
