import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles/global.css';

registerSW({ immediate: true });
const root = document.getElementById('root');
if (!root) {
  throw new Error('Application root is missing.');
}
createRoot(root).render(<App />);
