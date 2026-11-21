import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initToken } from './auth';
import { store } from './store';
import './styles.css';
import './styles/inspector.css';
import './styles/images.css';
import './styles/questions.css';
import './styles/previews.css';
import './styles/approvals.css';

initToken();
store.connect();
createRoot(document.getElementById('root')!).render(<App />);
