import * as React from "react";
import en from "@dlab5/app-i18n/en.json";
import de from "@dlab5/app-i18n/de.json";
import fr from "@dlab5/app-i18n/fr.json";

/**
 * The interface in English, German or French (packages/i18n; English is the
 * master and the fallback for a missing text).
 *
 * The language is, first found: what this person chose on this browser, the
 * `locale` of their account (so it follows them to another device), their
 * browser's language, English. Choosing one stores it in both places.
 *
 * Words people type themselves (names of things, places) are not here:
 * they live in the A-Box, with optional translations.
 */

export type Lang = "en" | "de" | "fr";
export const LANGS: Array<[Lang, string]> = [["en", "English"], ["de", "Deutsch"], ["fr", "Français"]];
type Catalog = Record<string, string>;
const CATALOGS: Record<Lang, Catalog> = { en: en as Catalog, de: de as Catalog, fr: fr as Catalog };
const KEY = "app-lang";

const isLang = (v: unknown): v is Lang => v === "en" || v === "de" || v === "fr";

export function storedLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function browserLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  for (const l of navigator.languages ?? [navigator.language]) {
    const two = (l || "").slice(0, 2).toLowerCase();
    if (isLang(two)) return two;
  }
  return "en";
}

/** `{name}` placeholders filled from vars; English, then the key, when a text is missing. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = CATALOGS[lang][key] ?? CATALOGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

export interface I18n {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** A date (and time) as people of this language write it. */
  date: (iso: string | Date, withTime?: boolean) => string;
  number: (n: number) => string;
}

const LOCALES: Record<Lang, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR" };

function make(lang: Lang, setLang: (l: Lang) => void): I18n {
  const locale = LOCALES[lang];
  return {
    lang, locale, setLang,
    t: (key, vars) => translate(lang, key, vars),
    date: (iso, withTime = false) => {
      const d = typeof iso === "string" ? new Date(iso) : iso;
      return Number.isNaN(d.getTime()) ? String(iso)
        : d.toLocaleString(locale, withTime
          ? { dateStyle: "medium", timeStyle: "short" }
          : { dateStyle: "medium" });
    },
    number: (n) => n.toLocaleString(locale),
  };
}

const Ctx = React.createContext<I18n>(make("en", () => undefined));

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>("en");
  React.useEffect(() => { setLangState(storedLang() ?? browserLang()); }, []);
  React.useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(KEY, l); } catch { /* private window */ }
    // the account remembers it too (best effort: a guest has no account)
    import("aws-amplify/auth")
      .then(({ updateUserAttributes }) => updateUserAttributes({ userAttributes: { locale: l } }))
      .catch(() => undefined);
  }, []);

  const value = React.useMemo(() => make(lang, setLang), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => React.useContext(Ctx);

/** After sign-in: the account's language, unless this browser already has one chosen. */
export function useAccountLang(locale: string | undefined) {
  const { setLang } = useT();
  React.useEffect(() => {
    if (!storedLang() && isLang(locale)) setLang(locale);
  }, [locale, setLang]);
}

/** A language picker for the header. */
export function LangPicker({ className }: { className?: string }) {
  const { lang, setLang, t } = useT();
  return (
    <select className={className ?? "app-select app-select--small"} value={lang} aria-label={t("app.language")}
      onChange={(e) => setLang(e.target.value as Lang)}>
      {LANGS.map(([l, name]) => <option key={l} value={l}>{name}</option>)}
    </select>
  );
}
