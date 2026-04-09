import { useState, lazy, Suspense } from 'react';
import { Chat } from './components/Chat';
import { useTheme } from './components/providers';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import './App.css';

// 代码分割：延迟加载大型组件
const ModelManager = lazy(() =>
  import('./components/ModelManager').then((m) => ({ default: m.ModelManager }))
);
const Settings = lazy(() =>
  import('./components/Settings').then((m) => ({ default: m.Settings }))
);

// 加载占位符组件
function LoadingFallback() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
      }}
    >
      <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        <div className="loading-spinner"></div>
        <p style={{ marginTop: '16px' }}>加载中...</p>
      </div>
    </div>
  );
}

type Tab = 'chat' | 'models' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="app-title">
          <h1>LM</h1>
        </div>

        {/* 主题切换按钮 */}
        <button
          className="theme-toggle"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        >
          {resolvedTheme === 'dark' ? '☀️' : '🌙'}
        </button>

        <ul className="nav-list">
          <li>
            <button
              className={activeTab === 'chat' ? 'active' : ''}
              onClick={() => setActiveTab('chat')}
              title="对话"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
          </li>
          <li>
            <button
              className={activeTab === 'models' ? 'active' : ''}
              onClick={() => setActiveTab('models')}
              title="模型"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
            </button>
          </li>
          <li>
            <button
              className={activeTab === 'settings' ? 'active' : ''}
              onClick={() => setActiveTab('settings')}
              title="设置"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </li>
        </ul>
      </nav>

      <main className="main-content">
        {activeTab === 'chat' && <Chat />}
        {activeTab === 'models' && (
          <ErrorBoundary
            fallback={
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                padding: '40px',
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                <h2 style={{ fontSize: '20px', marginBottom: '8px', color: 'var(--color-text-primary)' }}>
                  模型管理加载失败
                </h2>
                <p style={{ marginBottom: '16px' }}>
                  智能推荐功能可能需要后端支持。您可以使用其他功能。
                </p>
                <button
                  onClick={() => setActiveTab('chat')}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--color-primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  返回对话
                </button>
              </div>
            }
          >
            <Suspense fallback={<LoadingFallback />}>
              <ModelManager />
            </Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'settings' && (
          <div className="settings-wrapper">
            <Suspense fallback={<LoadingFallback />}>
              <Settings />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
