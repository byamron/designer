import { useEffect, useState } from "react";

/**
 * First-run onboarding. Dismissible slab that sits on top of the shell while
 * the user reads; once dismissed, it's remembered in localStorage so repeat
 * launches don't nag.
 *
 * Principles in effect:
 * - Calm by default. One surface, one idea per slide.
 * - Subtle confirmation — the slab is earned surface, not an interruption.
 * - Respects prefers-reduced-motion — no entrance animation.
 */
const STORAGE_KEY = "designer:onboarding-done";

export function Onboarding() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (dismissed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismiss();
      } else if (e.key === "ArrowRight") {
        setStep((s) => Math.min(2, s + 1));
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  const slides = [
    {
      kicker: "01",
      title: "You manage. Agents execute.",
      body: "Designer is a cockpit. You set direction, review outcomes, and make judgment calls. Git, branches, and PRs become plumbing you don't need to see.",
    },
    {
      kicker: "02",
      title: "Workspaces, not tickets.",
      body: "A workspace is a feature or initiative — one outcome, one team. Tabs inside a workspace share context automatically. Link anything with @-references.",
    },
    {
      kicker: "03",
      title: "Trust through legibility.",
      body: "The activity spine shows what every agent is doing at a glance. Approval gates protect merge / publish / prod-touch. Your Claude auth never leaves your machine.",
    },
  ];
  const slide = slides[step];

  return (
    <div
      className="quick-switcher-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Designer"
    >
      <div
        className="quick-switcher"
        style={{
          width: "calc(var(--space-8) * 9)",
          maxWidth: "92vw",
          padding: "var(--space-5)",
          gap: "var(--space-4)",
        }}
      >
        <span className="card__kicker">{`Welcome · ${step + 1} of ${slides.length}`}</span>
        <h1 style={{
          fontSize: "var(--type-h2-size)",
          lineHeight: "var(--type-h2-leading)",
          margin: 0,
          fontWeight: "var(--type-weight-semibold)",
        }}>{slide.title}</h1>
        <p style={{
          fontSize: "var(--type-lead-size)",
          lineHeight: "var(--type-lead-leading)",
          color: "var(--color-muted)",
          margin: 0,
        }}>{slide.body}</p>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "var(--space-4)",
        }}>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            {slides.map((_, i) => (
              <span
                key={i}
                className="state-dot"
                data-state={i === step ? "active" : "idle"}
                aria-hidden="true"
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button type="button" className="btn" onClick={dismiss}>Skip</button>
            {step < slides.length - 1 ? (
              <button
                type="button"
                className="btn"
                data-variant="primary"
                onClick={() => setStep((s) => s + 1)}
              >
                Next <kbd style={{ marginLeft: "var(--space-1)" }}>→</kbd>
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                data-variant="primary"
                onClick={dismiss}
              >
                Get started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
