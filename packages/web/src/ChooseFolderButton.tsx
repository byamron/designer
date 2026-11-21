import { pickFolder, type DesktopBridge } from './folderPicker';

/**
 * "Choose folder…": opens the desktop app's native folder dialog. Renders nothing in a plain browser, where the typed path field is
 * the only way (unchanged). No hooks, so it is trivially testable; the native dialog is modal, so there is no "busy" state to track.
 */
export function ChooseFolderButton({ bridge, onPick, onError }: { bridge: DesktopBridge | undefined; onPick: (path: string) => void; onError: (message: string) => void }) {
  if (!bridge) return null;
  const click = async () => {
    const r = await pickFolder(bridge);
    if (r.kind === 'picked') onPick(r.path);
    else if (r.kind === 'error') onError(r.message);
  };
  return (
    <button type="button" className="choose-folder" onClick={click}>
      Choose folder…
    </button>
  );
}
