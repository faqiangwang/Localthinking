/**
 * Local-thinking - 本地AI聊天应用
 * Copyright (C) 2025 faqiangwang <faqiangwang@163.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

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
