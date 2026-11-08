import * as React from "react";
import type { HeadFC } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";
import { approveDeviceCode, denyDeviceCode, describeDeviceCode, listTenants } from "../lib/data";
import type { DeviceCodeInfo, Tenant } from "../lib/data";
import { useT } from "../lib/i18n";

/**
 * Edge pairing approval: this site's counterpart of the DigitalHome Portal's /link
 * page in digitalhome.cloud (DH-SPEC-100, ADR-0006).
 *
 * An edge shows a code and a link to this page with ?user_code=…. A
 * tenant's admin signs in (AuthGate brings them back here), checks that
 * the host name is their machine, chooses the tenant, and approves. The
 * edge's next poll then receives its device token, valid for that
 * tenant's spaces only (ADR-0005). Approval is a mutation behind a
 * button, never a GET.
 */

const CODE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

const LinkPage: React.FC = () => {
  const session = useSession();
  const { t } = useT();
  const [code, setCode] = React.useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("user_code") || "").toUpperCase()
  );
  const [info, setInfo] = React.useState<DeviceCodeInfo | null>(null);
  const [outcome, setOutcome] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [tenant, setTenant] = React.useState("");

  React.useEffect(() => {
    if (!session.isAdmin) return;
    listTenants()
      .then((hs) => {
        const mine = hs.filter((h) => session.tenants.includes(h.id)).sort((a, b) => a.name.localeCompare(b.name));
        setTenants(mine);
        if (mine.length === 1) setTenant(mine[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const look = React.useCallback(async (c: string) => {
    setError(null);
    setInfo(null);
    setOutcome(null);
    if (!CODE.test(c)) return;
    setBusy(true);
    try { setInfo(await describeDeviceCode(c)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }, []);

  React.useEffect(() => { if (session.isAdmin && code) void look(code); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try { setOutcome(approve ? await approveDeviceCode(code, tenant) : await denyDeviceCode(code)); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  if (!session.isAdmin) {
    return (
      <Shell active="link" title={t("nav.link")}>
        <div className="app-empty">
          <p>{t("link.adminonly")}</p>
          <p className="app-muted">{t("link.askadmin")}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell active="link" title={t("nav.link")}>
      <div className="app-panel app-link">
        <h2 className="app-panel__title">{t("link.code")}</h2>
        <p className="app-panel__hint">{t("link.code.hint")}</p>
        <form
          className="app-link__form"
          onSubmit={(e) => { e.preventDefault(); void look(code); }}
        >
          <input
            className="app-input app-link__code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EF23"
            maxLength={9}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="app-button app-button--ghost" disabled={busy || !CODE.test(code)}>
            {t("link.lookup")}
          </button>
        </form>

        {error && <p className="app-error" role="alert">{error}</p>}

        {info && !outcome && (
          <>
            <dl className="app-facts">
              <dt>{t("link.host")}</dt><dd>{info.hostname ?? "—"}</dd>
              <dt>{t("link.lan")}</dt><dd>{info.lan_ip ?? "—"}</dd>
              <dt>{t("link.version")}</dt><dd>{info.dhe_version ?? "—"}</dd>
              <dt>{t("link.machine")}</dt><dd><code>{info.machine_id ?? "—"}</code></dd>
              <dt>{t("link.status")}</dt><dd>{info.status}</dd>
            </dl>
            {info.status === "pending" && (
              <div className="app-link__actions">
                <p className="app-panel__hint">{t("link.approve.hint")}</p>
                {tenants.length > 1 && (
                  <select className="app-select" value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label={t("link.tenant")}>
                    <option value="">{t("link.whichtenant")}</option>
                    {tenants.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                )}
                {tenants.length === 1 && <span className="app-muted">{t("link.for", { name: tenants[0].name })}</span>}
                <button type="button" className="app-button" disabled={busy || !tenant} onClick={() => void decide(true)}>
                  {t("link.approve")}
                </button>
                <button type="button" className="app-button app-button--ghost" disabled={busy} onClick={() => void decide(false)}>
                  {t("link.deny")}
                </button>
              </div>
            )}
          </>
        )}

        {outcome === "approved" && (
          <p className="app-ok" role="status">{t("link.approved")}</p>
        )}
        {outcome === "denied" && <p className="app-muted" role="status">{t("link.denied")}</p>}
      </div>
    </Shell>
  );
};

export default LinkPage;

export const Head: HeadFC = () => <title>Link an edge · template.dlab5</title>;
