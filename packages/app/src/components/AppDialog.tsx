import { useEffect, useRef } from "react";
import { closeDialog, useAppState } from "../store/app";
import { IconButton } from "./IconButton";
import { IconX } from "./icons";

/**
 * Help dialog — Settings migrated to the full-page SettingsPage, which
 * takes over the viewport (it's a global app surface, not a popover).
 * This component now only renders when `dialog === "help"`; the existing
 * modal pattern is the right register for a short, informational panel.
 */
export function AppDialog() {
  const dialog = useAppState((s) => s.dialog);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  if (dialog !== "help") return null;

  return (
    <div
      className="app-dialog-scrim"
      data-component="AppDialog"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeDialog();
      }}
    >
      <div
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <header className="app-dialog__head">
          <h2 className="app-dialog__title" id="app-dialog-title">
            Help
          </h2>
          <IconButton ref={closeBtnRef} label="Close" shortcut="Esc" onClick={closeDialog}>
            <IconX size={12} />
          </IconButton>
        </header>
        <div className="app-dialog__body">
          <HelpBody />
        </div>
      </div>
    </div>
  );
}

function HelpBody() {
  // The "Ask the help agent" input was a static placeholder with no
  // backing handler. Removed per the dogfood rule "no half-baked
  // features in prod"; the section returns once an answering agent
  // actually exists.
  return (
    <>
      <section className="app-dialog__section" aria-label="Keyboard shortcuts">
        <span className="app-dialog__section-label">Keyboard shortcuts</span>
        <dl className="app-dialog__kbd-list">
          <dt>Quick switcher</dt>
          <dd><kbd>⌘K</kbd></dd>
          <dt>New tab</dt>
          <dd><kbd>⌘T</kbd></dd>
          <dt>Close active tab</dt>
          <dd><kbd>⌘W</kbd></dd>
          <dt>Send message</dt>
          <dd><kbd>⌘↵</kbd></dd>
          <dt>Toggle project strip</dt>
          <dd><kbd>⌘\</kbd></dd>
          <dt>Toggle workspaces</dt>
          <dd><kbd>⌘[</kbd></dd>
          <dt>Toggle activity</dt>
          <dd><kbd>⌘]</kbd></dd>
          <dt>Help</dt>
          <dd><kbd>⌘?</kbd></dd>
        </dl>
      </section>
      <section className="app-dialog__section" aria-label="About">
        <span className="app-dialog__section-label">About</span>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Version</span>
          <span className="app-dialog__row-meta">alpha · local-first</span>
        </div>
      </section>
    </>
  );
}

