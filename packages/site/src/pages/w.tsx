import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { getSpace } from "../lib/data";
import type { Space } from "../lib/data";

/**
 * Every route under /w/.
 *
 * This is a client-only page (see `onCreatePage` in gatsby-node.ts): there is
 * no build-time list of space ids, and a space's content is
 * authenticated per-group data in S3, so there is nothing to statically
 * render. The id and the view come out of the URL at runtime.
 *
 * ONE page component for all five views rather than five matchPath routes.
 * The alternative needs a hosting rewrite per route (constraint 11 in the dlab5-cloud-template skill)
 * — configuration that lives outside this repository and that nobody will
 * remember to add.
 *
 * When a view outgrows a `case`, move it to its own component in
 * src/components/ and keep the switch as the router. Do not turn the switch
 * into a lookup table: the whole value of it is that the reader sees every
 * route a space has in one screenful.
 */

const VIEWS = [
  "overview",
  "items",
  "reports",
  "import",
  "export",
] as const;

type View = (typeof VIEWS)[number];

/**
 * `/w/s-4k9mqhtx2p/items/` → `{ id, view }`.
 *
 * A missing or unrecognised trailing segment resolves to "overview" rather
 * than 404: /w/<id>/ is the space's home, and a typo in a view name is
 * better answered with the space than with a dead end.
 */
function parse(pathname: string): { id?: string; view: View } {
  const parts = pathname.split("/").filter(Boolean); // ["w", id, view?]
  const id = parts[1];
  const candidate = parts[2] as View | undefined;
  return {
    id,
    view: candidate && VIEWS.includes(candidate) ? candidate : "overview",
  };
}

const SpacePage: React.FC<PageProps> = ({ location }) => {
  const { id, view } = parse(location.pathname);

  const [space, setSpace] = React.useState<Space | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "denied">(
    "loading"
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) {
      setState("denied");
      return;
    }
    getSpace(id)
      .then((found) => {
        setSpace(found);
        // null covers both "no such space" and "not yours". AppSync does
        // not distinguish them and neither does this screen — telling them
        // apart would let anyone enumerate ids.
        setState(found ? "ready" : "denied");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setState("denied");
      });
  }, [id]);

  if (state === "loading") {
    return (
      <Shell space={id ? { id, active: view } : undefined}>
        <p className="app-muted">Loading…</p>
      </Shell>
    );
  }

  if (state === "denied" || !space || !id) {
    return (
      <Shell>
        <h1>Not available</h1>
        <div className="app-empty">
          <p>No such space, or you do not have access to it.</p>
          <p className="app-muted">
            Access is granted by an admin of the space&rsquo;s tenant, in
            Settings: they add your account to the space&rsquo;s readers.
          </p>
          {error && (
            <p className="app-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell space={{ id, name: space.name, active: view }}>
      <div className="app-pagehead">
        <h1>{LABELS[view]}</h1>
        <span className="app-muted">{space.tenantName ? `${space.tenantName} · ` : ""}{space.name}</span>
      </div>
      <ViewBody view={view} space={space} />
    </Shell>
  );
};

const LABELS: Record<View, string> = {
  overview: "Overview",
  items: "Items",
  reports: "Reports",
  import: "Import",
  export: "Export",
};

/**
 * The placeholders.
 *
 * Each one names what belongs there rather than saying "TODO". A placeholder
 * with no content is a placeholder that gets deleted and reinvented.
 */
function ViewBody({ view, space }: { view: View; space: Space }) {
  switch (view) {
    case "overview":
      return (
        <div className="app-panel">
          <h2 className="app-panel__title">This space at a glance</h2>
          <dl className="app-stats">
            <div className="app-stat">
              <dt>{space.kind}</dt>
              <dd>Kind</dd>
            </div>
            <div className="app-stat">
              <dt>{space.tenantName ?? "—"}</dt>
              <dd>Tenant</dd>
            </div>
          </dl>
          <p className="app-panel__hint">
            The space&rsquo;s object lives in S3 at <code>spaces/{space.id}/data.json</code>{" "}
            and is read through <code>loadObject()</code> in{" "}
            <code>src/lib/data.ts</code>, which returns the content and the ETag
            a later save must present. What the tenant <em>knows</em> about the
            space is its A-Box: <code>loadGraph(space.id)</code>, synced with
            the tenant&rsquo;s edges. Build the real screen on those.
          </p>
        </div>
      );

    case "items":
      return (
        <div className="app-panel">
          <h2 className="app-panel__title">Whatever this app is about</h2>
          <p className="app-panel__hint">
            The space&rsquo;s own content: the list, the board, the canvas.
            It comes from <code>loadObject()</code>, is edited in memory, and
            goes back through <code>saveObject(id, value, etag)</code>. Handle
            the rejected save — objectProxy throws a message that already tells
            the reader to reload — because that is the case a demo never hits
            and a second user hits on their first afternoon.
          </p>
        </div>
      );

    case "reports":
      return (
        <div className="app-panel">
          <h2 className="app-panel__title">Derived views</h2>
          <p className="app-panel__hint">
            Anything computed from the space rather than stored in it.
            Compute it in <code>@dlab5/app-core</code> rather than in the
            component: it is then testable with <code>node --test</code>, and a
            future Lambda or CLI can produce the same answer.
          </p>
        </div>
      );

    case "import":
      return (
        <div className="app-panel">
          <h2 className="app-panel__title">Getting things in</h2>
          <p className="app-panel__hint">
            Parse in <code>@dlab5/app-core</code>, validate at the boundary with{" "}
            <code>assertSpace</code>-style checks that report every problem
            at once, and only then write — a parser that reports one problem
            per attempt turns a bad file into a sequence of guesses.
          </p>
        </div>
      );

    case "export":
      return (
        <div className="app-panel">
          <h2 className="app-panel__title">Getting things out</h2>
          <p className="app-panel__hint">
            A round trip that is only ever tested against itself proves nothing.
            Export, re-import under a fresh id, export THAT and compare byte for
            byte — going back out through storage is the point.
          </p>
        </div>
      );
  }
}

export default SpacePage;

export const Head: HeadFC = () => <title>Space · template.dlab5</title>;
