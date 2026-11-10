import * as React from "react";
import { useT } from "../lib/i18n";

/**
 * Two kinds of feedback every page shares, the same as on an edge's page
 * (python-tool-template core.js), so a person moving between the two finds
 * the same behaviour:
 *
 *   - the LOADING CARD: in the middle of the screen, after 300 ms, while any
 *     API call is out (lib/data.ts counts them) or a page wraps work in
 *     `track()`. A call faster than that never shows it. Clicks pass through.
 *   - BUTTON HELP: `data-help="…"` on any control shows its help ABOVE it
 *     after 600 ms (below only when there is no room), so it never covers
 *     what the pointer is on. Use it instead of `title`, which the browser
 *     draws over the control itself. Keyboard focus shows it too.
 *
 * The HELP SWITCH in the rail turns button help off for someone who knows
 * the app. It is on by default and remembered per browser, like the theme.
 *
 * Both layers are mounted once, in wrap-page-element.tsx, so a page needs
 * nothing but the attribute. They render nothing interactive on the server.
 */

/* -- the loading card ------------------------------------------------------ */

const BUSY_AFTER_MS = 300;
let busyCount = 0;
const busyListeners = new Set<(n: number) => void>();

/** +1 when work starts, -1 when it ends. */
export function busy(delta: number): void {
  busyCount = Math.max(0, busyCount + delta);
  busyListeners.forEach((f) => f(busyCount));
}

/** Show the loading card while `work` runs, if it takes longer than a moment. */
export async function track<T>(work: Promise<T> | (() => Promise<T>)): Promise<T> {
  busy(1);
  try {
    return await (typeof work === "function" ? work() : work);
  } finally {
    busy(-1);
  }
}

export function BusyCard() {
  const { t } = useT();
  const [working, setWorking] = React.useState(false);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const listen = (n: number) => setWorking(n > 0);
    busyListeners.add(listen);
    listen(busyCount);
    return () => {
      busyListeners.delete(listen);
    };
  }, []);

  React.useEffect(() => {
    if (!working) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), BUSY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [working]);

  return (
    <div className={`app-busy${shown ? " app-busy--on" : ""}`} role="status" aria-live="polite">
      {shown && (
        <div className="app-busy__card">
          <span className="app-busy__glass" aria-hidden="true" />
          <span className="app-busy__word">{t("lib.loading")}</span>
          <i className="app-busy__bar" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/* -- the help switch ------------------------------------------------------- */

export const HELP_KEY = "app-help";
let helpOn = true;
const helpListeners = new Set<(on: boolean) => void>();

function savedHelp(): boolean {
  try {
    return window.localStorage.getItem(HELP_KEY) !== "off";
  } catch {
    return true; // storage blocked: the default
  }
}

export function setHelp(on: boolean): void {
  helpOn = on;
  try {
    window.localStorage.setItem(HELP_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: this page only */
  }
  document.documentElement.setAttribute("data-app-help", on ? "on" : "off");
  helpListeners.forEach((f) => f(on));
}

export function useHelpOn(): [boolean, (on: boolean) => void] {
  // on during server rendering and the first client render, like the default
  const [on, setOn] = React.useState(true);
  React.useEffect(() => {
    helpListeners.add(setOn);
    setOn(helpOn);
    return () => {
      helpListeners.delete(setOn);
    };
  }, []);
  return [on, setHelp];
}

/**
 * The switch, in the rail's Appearance section and on the guest landing.
 * While off it keeps a `title`: the one thing that still explains it then.
 */
export function HelpSwitch() {
  const { t } = useT();
  const [on, set] = useHelpOn();
  return (
    <button
      type="button"
      className={`app-helpswitch${on ? " app-helpswitch--on" : ""}`}
      aria-pressed={on}
      data-help={t("help.switch.on")}
      title={on ? undefined : t("help.switch.off")}
      onClick={() => set(!on)}
    >
      <span aria-hidden="true">?</span> {t("help.switch")}
    </button>
  );
}

/* -- button help ----------------------------------------------------------- */

const HELP_AFTER_MS = 600;

/**
 * One tooltip for the whole document, driven by event delegation, so a
 * control rendered anywhere (a portal, a table row, a dialog) gets help by
 * carrying the attribute. Imperative on purpose: it follows the pointer
 * across components that know nothing of each other.
 */
export function HelpLayer() {
  React.useEffect(() => {
    helpOn = savedHelp();
    document.documentElement.setAttribute("data-app-help", helpOn ? "on" : "off");
    helpListeners.forEach((f) => f(helpOn));

    let timer: number | undefined;
    let pending: HTMLElement | null = null;
    let shown: HTMLElement | null = null;

    const box = (target: HTMLElement): HTMLElement => {
      // inside an open modal dialog, or it would sit beneath the backdrop, and
      // inside a fullscreen element, or it would not be drawn at all
      const full = document.fullscreenElement;
      const host = target.closest("dialog[open]") ?? (full && full.contains(target) ? full : document.body);
      let el = document.getElementById("app-help");
      if (!el) {
        el = document.createElement("div");
        el.id = "app-help";
        el.className = "app-help";
        el.setAttribute("role", "tooltip");
      }
      if (el.parentElement !== host) host.appendChild(el);
      return el;
    };

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      pending = null;
      if (shown?.getAttribute("aria-describedby") === "app-help") shown.removeAttribute("aria-describedby");
      shown = null;
      const el = document.getElementById("app-help");
      if (el) el.hidden = true;
    };

    const show = (target: HTMLElement) => {
      if (!target.isConnected || !target.dataset.help) return;
      const el = box(target);
      el.textContent = target.dataset.help;
      el.hidden = false;
      const r = target.getBoundingClientRect();
      const tip = el.getBoundingClientRect();
      const gap = 8;
      const above = r.top - tip.height - gap;
      const top = above >= 4 ? above : r.bottom + gap;
      const left = Math.min(Math.max(4, r.left + r.width / 2 - tip.width / 2), window.innerWidth - tip.width - 4);
      el.style.top = `${Math.round(top)}px`;
      el.style.left = `${Math.round(left)}px`;
      target.setAttribute("aria-describedby", "app-help");
      shown = target;
    };

    const start = (target: HTMLElement | null) => {
      if (!helpOn || !target || !target.dataset.help || target === pending || target === shown) return;
      hide();
      pending = target;
      timer = window.setTimeout(() => {
        pending = null;
        show(target);
      }, HELP_AFTER_MS);
    };

    const targetOf = (ev: Event): HTMLElement | null =>
      ev.target instanceof Element ? (ev.target.closest("[data-help]") as HTMLElement | null) : null;

    const over = (ev: PointerEvent) => {
      if (ev.pointerType !== "touch") start(targetOf(ev));
    };
    const out = (ev: PointerEvent) => {
      const t = targetOf(ev);
      if (t && !(ev.relatedTarget instanceof Node && t.contains(ev.relatedTarget))) hide();
    };
    const focus = (ev: FocusEvent) => {
      const t = targetOf(ev);
      if (t && t.matches(":focus-visible")) start(t);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") hide();
    };
    const switched = (on: boolean) => {
      if (!on) hide();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    helpListeners.add(switched);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      helpListeners.delete(switched);
    };
  }, []);
  return null;
}
