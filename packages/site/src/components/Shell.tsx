import * as React from "react";
import { Link } from "gatsby";
import { signOutAndReload, useSession } from "./AuthGate";
import { ThemeSegments } from "./ThemeSegments";
import { listSpaces } from "../lib/data";
import type { Space } from "../lib/data";
import { LangPicker, useT } from "../lib/i18n";

/**
 * The ONE application shell.
 *
 * One component, two layouts. Outside a space (`/`, Settings, About, /link)
 * there is nothing for a rail to navigate and it shows the switcher alone;
 * inside a space it renders the full rail.
 *
 * Resist adding a second shell for the next layout that does not quite fit.
 * The DHC Portal ended up with two and the seam still shows: a header that is
 * one pixel taller on half the routes, a theme toggle that exists twice and
 * disagrees with itself. If a screen needs a different frame, add a prop.
 *
 * The rail is PER-SPACE rather than global, because a space is this app's
 * authorization boundary — it has its own Cognito group (ADR-0005) — so
 * navigation cannot sit above it.
 */

export interface RailItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const icon = (path: React.ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

/**
 * The space's own views. Placeholders — this array and `toolItems` below
 * are the two a fork edits first.
 *
 * Keep `key` in step with the `active` value each page passes to Shell, and
 * with the switch in pages/w.tsx. Three places, deliberately: a rail entry, a
 * route and a screen are three different things, and collapsing them into one
 * table is how a route ends up with no way to be inactive.
 */
export function railItems(id: string): RailItem[] {
  return [
    {
      key: "overview",
      label: "Overview",
      href: `/w/${id}/`,
      icon: icon(<path d="M4 6h16M4 12h11M4 18h7" />),
    },
    {
      key: "items",
      label: "Items",
      href: `/w/${id}/items/`,
      icon: icon(
        <>
          <rect x="3" y="4" width="7" height="6" rx="1.4" />
          <rect x="14" y="14" width="7" height="6" rx="1.4" />
          <path d="M6.5 10v6h7.5" />
        </>
      ),
    },
    {
      key: "reports",
      label: "Reports",
      href: `/w/${id}/reports/`,
      icon: icon(
        <>
          <path d="M9 4h7l4 4v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
          <path d="M16 4v4h4" />
          <path d="M11 13h6M11 17h4" />
        </>
      ),
    },
  ];
}

/**
 * Tools, kept apart from the views ON PURPOSE.
 *
 * The Space section answers "what does this look like"; these answer "how
 * do things get in and out of it". Mixing them turns a rail into a list of
 * eleven items with no shape, and buries an importer inside a screen where
 * nobody looking for one would think to check.
 */
export function toolItems(id: string): RailItem[] {
  return [
    {
      key: "import",
      label: "Import",
      href: `/w/${id}/import/`,
      // An arrow entering a tray.
      icon: icon(
        <>
          <path d="M12 3v10" />
          <path d="m8 9 4 4 4-4" />
          <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
        </>
      ),
    },
    {
      key: "export",
      label: "Export",
      href: `/w/${id}/export/`,
      icon: icon(
        <>
          <path d="M12 13V3" />
          <path d="m8 7 4-4 4 4" />
          <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
        </>
      ),
    },
  ];
}

function Mark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 8h8M8 12h5M8 16h3" />
      </svg>
    </span>
  );
}

/**
 * Choosing a space.
 *
 * A select rather than a list of links: the number of spaces is unbounded,
 * and a rail listing forty of them scrolls the appearance and account sections
 * off the bottom — at which point the rail has stopped being navigation. It
 * carries the current space inside itself, and rests unselected elsewhere.
 * With more than one tenant, the tenant's name prefixes each space.
 */
function SpaceSwitcher({ id }: { id?: string }) {
  const { t } = useT();
  const [spaces, setSpaces] = React.useState<Space[] | null>(null);

  React.useEffect(() => {
    listSpaces()
      .then(setSpaces)
      .catch(() => setSpaces([]));
  }, []);

  const empty = spaces !== null && spaces.length === 0;
  const manyTenants = new Set(spaces?.map((s) => s.tenantId)).size > 1;

  return (
    <div className="app-rail__switcher">
      <label className="app-rail__switcherlabel" htmlFor="app-space">
        {id ? t("shell.space") : t("shell.openspace")}
      </label>
      <select
        id="app-space"
        value={id ?? ""}
        disabled={empty}
        onChange={(e) => {
          if (!e.target.value) return;
          // A full navigation rather than client routing: every screen reloads
          // its data from the new space anyway, and this keeps the URL and the
          // rail in step without a router dependency.
          window.location.assign(`/w/${e.target.value}/`);
        }}
      >
        {/* Outside a space nothing is open yet, so the control needs a
            resting state that is not a space. */}
        {!id && (
          <option value="">
            {spaces === null ? t("lib.loading") : empty ? t("shell.nospaces") : t("shell.choose", { n: spaces.length })}
          </option>
        )}
        {/* The current space is always an option, even before the list
            arrives, so the control never renders empty or wrong. */}
        {id && !spaces?.some((s) => s.id === id) && (
          <option value={id}>{spaces === null ? t("lib.loading") : id}</option>
        )}
        {spaces?.map((s) => (
          <option key={s.id} value={s.id}>
            {manyTenants && s.tenantName ? `${s.tenantName} · ` : ""}{s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A labelled group of rail entries. */
function RailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app-rail__section">
      <h2 className="app-rail__sectionlabel">{label}</h2>
      {children}
    </div>
  );
}

function RailLinks({ items, active }: { items: RailItem[]; active: string }) {
  return (
    <ul className="app-rail__items">
      {items.map((item) => (
        <li key={item.key}>
          {/* A plain <a>, not gatsby's <Link>: these are matchPath routes, so
              there is no page for Gatsby to prefetch and Link would warn. */}
          <a
            href={item.href}
            className={`app-rail__item${
              item.key === active ? " app-rail__item--on" : ""
            }`}
            aria-current={item.key === active ? "page" : undefined}
          >
            {item.icon}
            {item.label}
            {item.key === active && (
              <span className="app-rail__dot" aria-hidden="true" />
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

interface ShellProps {
  children: React.ReactNode;
  /**
   * Present inside a space; absent elsewhere.
   *
   * `name` is what a reader sees; `id` is the opaque id (ADR-0003) and must
   * never be rendered where a name belongs.
   */
  space?: { id: string; name?: string | null; active: string };
  /** Outside a space: which account entry is current, and the header title. */
  active?: string;
  title?: string;
}

export function Shell({ children, space, active, title }: ShellProps) {
  const session = useSession();
  const { t } = useT();
  const [railOpen, setRailOpen] = React.useState(true);

  return (
    <div className="app-shell app-shell--railed">
      <nav
        className={`app-rail${railOpen ? "" : " app-rail--closed"}`}
        aria-label={space ? t("shell.spaceviews") : t("nav.spaces")}
      >
        <Link className="app-rail__brand" to="/">
          <Mark />
          <span>
            template<span className="app-rail__brandaccent">.dlab5</span>
          </span>
        </Link>

        {space ? (
          <>
            <SpaceSwitcher id={space.id} />
            <RailSection label={t("shell.space")}>
              <RailLinks items={railItems(space.id)} active={space.active} />
            </RailSection>
            <RailSection label={t("shell.tools")}>
              <RailLinks items={toolItems(space.id)} active={space.active} />
            </RailSection>
          </>
        ) : (
          // Outside a space the rail offers spaces rather than views. The
          // views all act on a space, so showing them here would be controls
          // that cannot do anything until one is chosen. The switcher carries
          // its own label, so a section wrapper would say the word twice.
          <SpaceSwitcher />
        )}

        <RailSection label={t("shell.appearance")}>
          <ThemeSegments />
          <LangPicker className="app-select app-select--small" />
        </RailSection>

        <RailSection label={t("shell.account")}>
          <ul className="app-rail__items">
            <li>
              <Link className={`app-rail__item${active === "settings" ? " app-rail__item--on" : ""}`} to="/settings/">
                {icon(
                  <>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
                  </>
                )}
                {t("nav.settings")}
              </Link>
            </li>
            {(session.isAdmin || session.isOperator) && (
              <li>
                <Link className={`app-rail__item${active === "link" ? " app-rail__item--on" : ""}`} to="/link/">
                  {icon(
                    <>
                      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                    </>
                  )}
                  {t("nav.link")}
                </Link>
              </li>
            )}
            <li>
              <Link className={`app-rail__item${active === "about" ? " app-rail__item--on" : ""}`} to="/about/">
                {icon(
                  <>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5M12 8h.01" />
                  </>
                )}
                {t("nav.about")}
              </Link>
            </li>
            <li>
              <a
                className="app-rail__item"
                href="https://github.com/d-lab-5/template-dlab5-cloud"
                target="_blank"
                rel="noreferrer noopener"
              >
                {icon(
                  <path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.4.4-.5.9-.5 1.5V21" />
                )}
                Source
              </a>
            </li>
            <li>
              <button
                type="button"
                className="app-rail__item app-rail__item--button"
                onClick={() => void signOutAndReload()}
              >
                {icon(
                  <>
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M14 17l5-5-5-5M19 12H9" />
                  </>
                )}
                {t("nav.signout")}
              </button>
            </li>
          </ul>
          <p className="app-rail__who">
            {session.email ?? session.username}
            {session.isOperator ? ` · ${t("set.role.operator")}` : session.isAdmin ? ` · ${t("set.role.admin")}` : ""}
          </p>
        </RailSection>
      </nav>

      <div className="app-shell__body">
        <header className="app-shell__header">
          <button
            type="button"
            className="app-linkbutton app-shell__railtoggle"
            onClick={() => setRailOpen((open) => !open)}
            aria-label={railOpen ? t("shell.hidemenu") : t("shell.showmenu")}
            aria-expanded={railOpen}
          >
            ☰
          </button>
          <span className="app-shell__title">
            {space ? (space.name ?? space.id) : (title ?? t("nav.spaces"))}
          </span>
          <span className="app-shell__meta">/ internal · admin-provisioned</span>
          <span className="app-shell__spacer" />
        </header>

        <main className="app-shell__main">{children}</main>
      </div>
    </div>
  );
}
