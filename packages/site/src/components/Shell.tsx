import * as React from "react";
import { Link } from "gatsby";
import { signOutAndReload, useSession } from "./AuthGate";
import { ThemeSegments } from "./ThemeSegments";
import { listWorkspaces } from "../lib/data";
import type { Workspace } from "../lib/data";

/**
 * The ONE application shell.
 *
 * One component, two layouts. At `/` there is no workspace, so there is
 * nothing for a rail to navigate and it shows the switcher alone; inside a
 * workspace it renders the full rail.
 *
 * Resist adding a second shell for the next layout that does not quite fit.
 * The DHC Portal ended up with two and the seam still shows: a header that is
 * one pixel taller on half the routes, a theme toggle that exists twice and
 * disagrees with itself. If a screen needs a different frame, add a prop.
 *
 * The rail is PER-WORKSPACE rather than global, because a workspace is this
 * app's authorization boundary — it has its own Cognito group — so navigation
 * cannot sit above it.
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
 * The workspace's own views. Placeholders — this array and `toolItems` below
 * are the two a fork edits first.
 *
 * Keep `key` in step with the `active` value each page passes to Shell, and
 * with the switch in pages/w.tsx. Three places, deliberately: a rail entry, a
 * route and a screen are three different things, and collapsing them into one
 * table is how a route ends up with no way to be inactive.
 */
export function railItems(slug: string): RailItem[] {
  return [
    {
      key: "overview",
      label: "Overview",
      href: `/w/${slug}/`,
      icon: icon(<path d="M4 6h16M4 12h11M4 18h7" />),
    },
    {
      key: "items",
      label: "Items",
      href: `/w/${slug}/items/`,
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
      href: `/w/${slug}/reports/`,
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
 * The Workspace section answers "what does this look like"; these answer "how
 * do things get in and out of it". Mixing them turns a rail into a list of
 * eleven items with no shape, and buries an importer inside a screen where
 * nobody looking for one would think to check.
 */
export function toolItems(slug: string): RailItem[] {
  return [
    {
      key: "import",
      label: "Import",
      href: `/w/${slug}/import/`,
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
      href: `/w/${slug}/export/`,
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
 * Choosing a workspace.
 *
 * A select rather than a list of links: the number of workspaces is unbounded,
 * and a rail listing forty of them scrolls the appearance and account sections
 * off the bottom — at which point the rail has stopped being navigation. It
 * carries the current workspace inside itself, and rests unselected at `/`.
 */
function WorkspaceSwitcher({ slug }: { slug?: string }) {
  const [workspaces, setWorkspaces] = React.useState<Workspace[] | null>(null);

  React.useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
  }, []);

  const empty = workspaces !== null && workspaces.length === 0;

  return (
    <div className="app-rail__switcher">
      <label className="app-rail__switcherlabel" htmlFor="app-workspace">
        {slug ? "Workspace" : "Open a workspace"}
      </label>
      <select
        id="app-workspace"
        value={slug ?? ""}
        disabled={empty}
        onChange={(e) => {
          if (!e.target.value) return;
          // A full navigation rather than client routing: every screen reloads
          // its data from the new workspace anyway, and this keeps the URL and
          // the rail in step without a router dependency.
          window.location.assign(`/w/${e.target.value}/`);
        }}
      >
        {/* At `/` nothing is open yet, so the control needs a resting state
            that is not a workspace. */}
        {!slug && (
          <option value="">
            {workspaces === null
              ? "Loading…"
              : empty
                ? "No workspaces yet"
                : `Choose one of ${workspaces.length}…`}
          </option>
        )}
        {/* The current workspace is always an option, even before the list
            arrives, so the control never renders empty or wrong. */}
        {slug && !workspaces?.some((w) => w.slug === slug) && (
          <option value={slug}>{workspaces === null ? "Loading…" : slug}</option>
        )}
        {workspaces?.map((w) => (
          <option key={w.slug} value={w.slug}>
            {w.name}
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
   * Present inside a workspace; absent at `/`.
   *
   * `name` is what a reader sees; `slug` is the opaque id (ADR-0003) and must
   * never be rendered where a name belongs.
   */
  workspace?: { slug: string; name?: string | null; active: string };
}

export function Shell({ children, workspace }: ShellProps) {
  const session = useSession();
  const [railOpen, setRailOpen] = React.useState(true);

  return (
    <div className="app-shell app-shell--railed">
      <nav
        className={`app-rail${railOpen ? "" : " app-rail--closed"}`}
        aria-label={workspace ? "Workspace views" : "Workspaces"}
      >
        <Link className="app-rail__brand" to="/">
          <Mark />
          <span>
            template<span className="app-rail__brandaccent">.dlab5</span>
          </span>
        </Link>

        {workspace ? (
          <>
            <WorkspaceSwitcher slug={workspace.slug} />
            <RailSection label="Workspace">
              <RailLinks
                items={railItems(workspace.slug)}
                active={workspace.active}
              />
            </RailSection>
            <RailSection label="Tools">
              <RailLinks
                items={toolItems(workspace.slug)}
                active={workspace.active}
              />
            </RailSection>
          </>
        ) : (
          // At `/` the rail offers workspaces rather than views. The views all
          // act on a workspace, so showing them here would be five controls
          // that cannot do anything until one is chosen. The switcher carries
          // its own label, so a section wrapper would say the word twice.
          <WorkspaceSwitcher />
        )}

        <RailSection label="Appearance">
          <ThemeSegments />
        </RailSection>

        <RailSection label="Account">
          <ul className="app-rail__items">
            <li>
              <Link className="app-rail__item" to="/settings/">
                {icon(
                  <>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
                  </>
                )}
                Settings
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
                Sign out
              </button>
            </li>
          </ul>
          <p className="app-rail__who">
            {session.email ?? session.username}
            {session.isAdmin ? " · admin" : ""}
          </p>
        </RailSection>
      </nav>

      <div className="app-shell__body">
        <header className="app-shell__header">
          <button
            type="button"
            className="app-linkbutton app-shell__railtoggle"
            onClick={() => setRailOpen((open) => !open)}
            aria-label={railOpen ? "Hide menu" : "Show menu"}
            aria-expanded={railOpen}
          >
            ☰
          </button>
          <span className="app-shell__title">
            {workspace ? (workspace.name ?? workspace.slug) : "Workspaces"}
          </span>
          <span className="app-shell__meta">/ internal · admin-provisioned</span>
          <span className="app-shell__spacer" />
        </header>

        <main className="app-shell__main">{children}</main>
      </div>
    </div>
  );
}
