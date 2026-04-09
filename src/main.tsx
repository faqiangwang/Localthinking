import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './components/providers';
import { ErrorBoundary } from './components/shared';
import './styles/reset.css';
import './styles/global.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </ErrorBoundary>
);
