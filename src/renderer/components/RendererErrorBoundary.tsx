import { Component, type ErrorInfo, type ReactNode } from "react";

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  crashed: boolean;
  recoveryKey: number;
};

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {
    crashed: false,
    recoveryKey: 0,
  };

  static getDerivedStateFromError(): Partial<RendererErrorBoundaryState> {
    return { crashed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Renderer recovered from an uncaught React error.", {
      name: error.name,
      componentStack: errorInfo.componentStack,
    });
  }

  private retry = () => {
    this.setState((current) => ({
      crashed: false,
      recoveryKey: current.recoveryKey + 1,
    }));
  };

  render() {
    if (this.state.crashed) {
      return (
        <main className="renderer-recovery-surface" role="alert">
          <section>
            <span>Zerox Agent</span>
            <h1>界面遇到错误，任务数据仍保留在本地</h1>
            <p>
              可以先重试界面；如果问题仍然存在，重新载入应用会从持久化状态恢复。
            </p>
            <div>
              <button className="primary-action" onClick={this.retry} type="button">
                重试界面
              </button>
              <button
                className="secondary-action"
                onClick={() => window.location.reload()}
                type="button"
              >
                重新载入
              </button>
            </div>
          </section>
        </main>
      );
    }
    return <div key={this.state.recoveryKey}>{this.props.children}</div>;
  }
}
