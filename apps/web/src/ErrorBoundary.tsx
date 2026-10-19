import { Component, type ReactNode, type ErrorInfo } from "react";
import { diagnosticError } from "../../../packages/reader-core/src/diagnostics";
import { reportDiagnostic } from "./diagnostics";
import { DiagnosticExport } from "./DiagnosticExport";
import { Button } from "@reader/ui/components/button";

type Props = { fallback: ReactNode; resetKey?: unknown; children?: ReactNode };
type State = { failed: boolean; resetKey: unknown };

/** Keeps a render error inside its subtree. A changed resetKey renders the children again. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: Props, state: State) {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { failed: false, resetKey: props.resetKey };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportDiagnostic({
      level: "error",
      event: "react.render_failed",
      ...diagnosticError(error),
      stack: (
        (diagnosticError(error).stack || "") +
        "\n" +
        (info.componentStack || "")
      ).slice(0, 8000),
    });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Last resort for the whole window; reading progress is saved by the close flush, not by React. */
export function AppCrash() {
  return (
    <div
      role="alert"
      className="flex h-screen flex-col items-center justify-center gap-3 text-sm [-webkit-app-region:drag]"
    >
      <p>界面出现错误</p>
      <Button
        variant="outline"
        size="sm"
        className="[-webkit-app-region:no-drag]"
        onClick={() => location.reload()}
      >
        重新加载
      </Button>
      <DiagnosticExport />
    </div>
  );
}
