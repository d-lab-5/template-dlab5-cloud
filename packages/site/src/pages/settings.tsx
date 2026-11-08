import * as React from "react";
import type { HeadFC } from "gatsby";
import { Shell } from "../components/Shell";
import { refreshGroups, useSession } from "../components/AuthGate";
import { MfaSetup } from "../components/MfaSetup";
import { TenantPanel, OperatorPanel } from "../components/Tenants";
import { edgeRelease, listEdges, listTenants, revokeEdge } from "../lib/data";
import type { EdgeRelease, EdgeSummary } from "../lib/data";
import { appInfo, versionAtLeast } from "../lib/about";
import { LangPicker, useT } from "../lib/i18n";

/**
 * The account; for a tenant's admins its spaces, members and edges; for
 * operators new tenants and every edge (ADR-0005).
 */
const SettingsPage: React.FC = () => {
  const session = useSession();
  const { t } = useT();

  return (
    <Shell active="settings" title={t("nav.settings")}>
      <div className="app-pagehead">
        <h1>{t("nav.settings")}</h1>
        <span className="app-badge">
          {[session.isOperator && t("set.role.operator"), session.isAdmin && t("set.role.admin"),
            session.isMember && !session.isAdmin && t("set.role.member")].filter(Boolean).join(" · ") || t("set.role.none")}
        </span>
      </div>

      <div className="app-panel">
        <h2 className="app-panel__title">{t("set.account")}</h2>
        <dl className="app-stats">
          <div className="app-stat">
            <dt>{session.email ?? session.username}</dt>
            <dd>{t("set.signedinas")}</dd>
          </div>
          <div className="app-stat">
            <dt>{session.groups.length}</dt>
            <dd>{t("set.groups")}</dd>
          </div>
        </dl>
        <p className="app-panel__hint">
          {t("set.groups.hint", { groups: session.groups.length ? session.groups.join(", ") : t("set.none") })}
        </p>
        <p className="app-panel__hint">
          <label>{t("set.language")} <LangPicker /></label> {t("set.language.hint")}
        </p>
      </div>

      <MfaPanel />

      {session.isAdmin && <TenantPanel />}
      {session.isOperator && <OperatorPanel />}
      {(session.isAdmin || session.isOperator) && <EdgesPanel />}
      {(session.isAdmin || session.isOperator) && <InstallEdgePanel />}
    </Shell>
  );
};

/** Two-step sign-in: on or off, and turning it on (optional for members, required for admins). */
function MfaPanel() {
  const session = useSession();
  const { t } = useT();
  const [setting, setSetting] = React.useState(false);
  return (
    <div className="app-panel" style={{ marginTop: "1rem" }}>
      <h2 className="app-panel__title">{t("mfa.title")}</h2>
      <p className="app-panel__hint">{session.mfa ? t("mfa.on") : t("mfa.off")}</p>
      {!session.mfa && !setting && (
        <button type="button" className="app-button" onClick={() => setSetting(true)}>{t("mfa.start")}</button>
      )}
      {!session.mfa && setting && <MfaSetup email={session.email} onDone={() => void refreshGroups()} />}
    </div>
  );
}

/** Another PC: the installer and package, checked, with the steps (needs Python 3.10+). */
function InstallEdgePanel() {
  const { t } = useT();
  const [release, setRelease] = React.useState<EdgeRelease | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const get = async () => {
    setBusy(true); setError(null);
    try { setRelease(await edgeRelease()); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const pyInstaller = release?.files.find((f) => f.name.endsWith(".py"));
  const installer = release?.files.find((f) => f.name.endsWith(".sh"));
  const pkg = release?.files.find((f) => f.name.endsWith(".whl"));
  // the edge repository's publish script names them; release.json says how
  const pyName = pyInstaller?.name ?? "install_edge.py";
  const home = `~/${release?.name ?? "edge"}`;
  return (
    <div className="app-panel" id="install-edge" style={{ marginTop: "1rem" }}>
      <h2 className="app-panel__title">{t("install.title")}</h2>
      <p className="app-panel__hint">{t("install.hint")}</p>
      <ol className="app-steps">
        <li>{t("install.step.python")}</li>
        <li>{t("install.step.download")}</li>
        <li>{t("install.step.run")} <code>python3 {pyName}</code> {t("install.step.windows")} <code>py {pyName}</code></li>
        <li>{t("install.step.first")}</li>
        <li>{t("install.step.link")} <a href="/link/">{t("nav.link")}</a></li>
      </ol>
      {!release && (
        <button type="button" className="app-button" onClick={() => void get()} disabled={busy}>
          {busy ? "…" : t("install.get")}
        </button>
      )}
      {error && <p className="app-error" role="alert">{error}</p>}
      {release && installer && pkg && (
        <>
          <p className="app-panel__hint">{t("install.version", { v: release.version, min: release.minVersion })}</p>
          <div className="app-install">
            {pyInstaller && <a className="app-button" href={pyInstaller.url} download={pyInstaller.name}>{t("install.installer.py")}</a>}
            <a className="app-button app-button--ghost" href={pkg.url} download={pkg.name}>{t("install.package")}</a>
            <a className="app-button app-button--ghost" href={installer.url} download={installer.name}>{t("install.installer")}</a>
          </div>
          <details className="app-install__manual">
            <summary>{t("install.manual")}</summary>
            <pre className="app-install__cmd">{`python3 -m venv ${home}/venv
${home}/venv/bin/python -m pip install ${pkg.name}
${home}/venv/bin/python -m ${release.module ?? "<module>"}`}</pre>
            <p className="app-muted">{t("install.manual.hint")}</p>
          </details>
          <p className="app-panel__hint">{t("install.sameplace")}</p>
          <p className="app-muted app-install__sha">SHA-256 {pkg.name}: <code>{pkg.sha256}</code></p>
          <p className="app-muted">{t("install.expires")}</p>
        </>
      )}
    </div>
  );
}

function EdgesPanel() {
  const [edges, setEdges] = React.useState<EdgeSummary[] | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const { t, date } = useT();
  const minEdge = appInfo().minEdgeVersion;

  const load = React.useCallback(() => {
    listEdges().then(setEdges).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    listTenants().then((hs) => setNames(Object.fromEntries(hs.map((h) => [h.id, h.name])))).catch(() => undefined);
  }, []);
  React.useEffect(load, [load]);

  const revoke = async (edge: EdgeSummary) => {
    if (!window.confirm(t("edges.revoke.confirm", { name: edge.hostname ?? edge.edge_id }))) return;
    try {
      await revokeEdge(edge.edge_id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="app-panel" style={{ marginTop: "1rem" }}>
      <h2 className="app-panel__title">{t("edges.title")}</h2>
      <p className="app-panel__hint">{t("edges.hint")} <a href="/link/">{t("nav.link")}</a></p>
      {error && <p className="app-error" role="alert">{error}</p>}
      {!edges && !error && <p className="app-muted">{t("lib.loading")}</p>}
      {edges?.length === 0 && <p className="app-muted">{t("edges.none")}</p>}
      {edges && edges.length > 0 && (
        <table className="app-table">
          <thead>
            <tr><th>{t("link.host")}</th><th>{t("edges.tenant")}</th><th>{t("link.version")}</th><th>{t("link.status")}</th><th>{t("edges.lastseen")}</th><th /></tr>
          </thead>
          <tbody>
            {edges.map((e) => (
              <tr key={e.edge_id}>
                <td title={e.edge_id}>{e.hostname ?? e.edge_id}</td>
                <td>{e.tenant_id ? names[e.tenant_id] ?? e.tenant_id : <span className="app-muted">{t("edges.relink")}</span>}</td>
                <td>
                  {e.dhe_version ?? "—"}
                  {!versionAtLeast(e.dhe_version, minEdge) && (
                    <span className="app-error" title={t("edges.tooold.title", { min: minEdge ?? "" })}> · {t("edges.tooold")}</span>
                  )}
                </td>
                <td>{e.status}</td>
                <td>{e.last_telemetry_at ? date(e.last_telemetry_at, true) : t("edges.never")}</td>
                <td>
                  {e.status === "linked" && (
                    <button type="button" className="app-button app-button--ghost" onClick={() => void revoke(e)}>
                      {t("edges.revoke")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default SettingsPage;

export const Head: HeadFC = () => <title>Settings · template.dlab5</title>;
