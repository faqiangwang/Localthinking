// src/components/shared/ErrorBoundary.tsx
// 错误边界组件

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            padding: '24px',
            textAlign: 'center',
            background: 'var(--color-bg-secondary)',
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '16px',
            }}>⚠️</div>
            <h2 style={{
              fontSize: 'var(--font-size-3xl)',
              fontWeight: 'var(--font-weight-semibold)',
              marginBottom: '8px',
              color: 'var(--color-text-primary)',
            }}>
              出错了
            </h2>
            <p style={{
              fontSize: 'var(--font-size-md)',
              color: 'var(--color-text-secondary)',
              marginBottom: '24px',
              maxWidth: '400px',
            }}>
              应用程序遇到了一个错误。请尝试刷新页面，如果问题持续存在，请联系支持。
            </p>
            {this.state.error && (
              <details style={{
                marginBottom: '24px',
                textAlign: 'left',
                maxWidth: '600px',
                width: '100%',
              }}>
                <summary style={{
                  cursor: 'pointer',
                  padding: '8px',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '8px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--font-weight-medium)',
                }}>
                  错误详情
                </summary>
                <pre style={{
                  padding: '12px',
                  background: 'var(--color-gray-900)',
                  color: 'var(--color-gray-50)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-sm)',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {this.state.error.toString()}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 24px',
                background: 'var(--color-primary)',
                color: 'var(--color-text-inverse)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--font-weight-medium)',
                cursor: 'pointer',
                transition: 'all var(--transition-base)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-primary-dark)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-primary)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              刷新页面
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

// Hook: 使用错误边界（用于函数组件）
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback} onError={onError}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
