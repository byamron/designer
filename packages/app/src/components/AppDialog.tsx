import { useEffect, useRef, useState } from "react";
import { closeDialog, useAppState } from "../store/app";
import { IconButton } from "./IconButton";
import { SegmentedToggle } from "./SegmentedToggle";
import { IconX } from "./icons";
import {
  getThemeMode,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from "../theme";

/**
 * Stub dialogs for Settings and Help — scoped to what the UX feedback calls
 * for (appearance, account, model connection, preferences; help with a
 * question input + keyboard shortcuts). Content is intentionally minimal;
 * each row below is a placeholder for the real surface, which will grow as
 * Phase 13 wires the settings core.
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

  if (!dialog) return null;

  return (
    <div
      className="app-dialog-scrim"
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
            {dialog === "settings" ? "Settings" : "Help"}
          </h2>
          <IconButton ref={closeBtnRef} label="Close" shortcut="Esc" onClick={closeDialog}>
            <IconX size={12} />
          </IconButton>
        </header>
        <div className="app-dialog__body">
          {dialog === "settings" ? <SettingsBody /> : <HelpBody />}
        </div>
      </div>
    </div>
  );
}

function SettingsBody() {
  return (
    <>
      <section className="app-dialog__section" aria-label="Appearance">
        <span className="app-dialog__section-label">Appearance</span>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Theme</span>
          <ThemePicker />
        </div>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Density</span>
          <span className="app-dialog__row-meta">balanced</span>
        </div>
      </section>
      <section className="app-dialog__section" aria-label="Account">
        <span className="app-dialog__section-label">Account</span>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Claude Code</span>
          <span className="app-dialog__row-meta">signed in on this machine</span>
        </div>
      </section>
      <section className="app-dialog__section" aria-label="Models">
        <span className="app-dialog__section-label">Models</span>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Default</span>
          <span className="app-dialog__row-meta">opus-4.7</span>
        </div>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Local (on-device)</span>
          <span className="app-dialog__row-meta">mlx · auto</span>
        </div>
      </section>
      <section className="app-dialog__section" aria-label="Preferences">
        <span className="app-dialog__section-label">Preferences</span>
        <div className="app-dialog__row">
          <span className="app-dialog__row-label">Default autonomy</span>
          <span className="app-dialog__row-meta">suggest</span>
        </div>
      </section>
    </>
  );
}

function ThemePicker() {
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());

  useEffect(() => {
    const unsub = subscribeTheme((m) => setMode(m));
    return unsub;
  }, []);

  return (
    <SegmentedToggle<ThemeMode>
      ariaLabel="Theme"
      value={mode}
      onChange={setThemeMode}
      options={[
        { value: "system", label: "System", tooltip: "Follow macOS appearance" },
        { value: "light", label: "Light", tooltip: "Force light mode" },
        { value: "dark", label: "Dark", tooltip: "Force dark mode" },
      ]}
    />
  );
}

function HelpBody() {
  return (
    <>
      <section className="app-dialog__section" aria-label="Ask">
        <span className="app-dialog__section-label">Ask</span>
        <input
          type="text"
          className="quick-switcher__input"
          placeholder="What would you like to know about Designer?"
          aria-label="Ask the help agent"
        />
      </section>
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

