import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initToken } from './auth';
import { store } from './store';
import './styles.css';
import './styles/inspector.css';

initToken();
store.connect();
createRoot(document.getElementById('root')!).render(<App />);
