import { useStore } from './store';
import { Sidebar } from './Sidebar';
import { Main } from './Workbench';

export function App() {
  const connected = useStore((s) => s.connected);
  const cannotConnect = useStore((s) => s.cannotConnect);
  if (cannotConnect) {
    return (
      <main className="main empty" role="alert">
        <div className="gate">
          <h1>Can't connect</h1>
          <p>Open the link printed in the terminal where you ran <code>npm start</code>. It contains a private token that lets this page talk to the app.</p>
          <p className="muted">If the server isn't running, start it and open the link again.</p>
        </div>
      </main>
    );
  }
  return (
    <div className="app">
      <Sidebar />
      <Main />
      {!connected && <div className="conn">Reconnecting…</div>}
    </div>
  );
}
