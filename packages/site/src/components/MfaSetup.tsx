import * as React from "react";
import qrcode from "qrcode-generator";
import { setUpTOTP, updateMFAPreference, verifyTOTPSetup } from "aws-amplify/auth";
import { useT } from "../lib/i18n";

/**
 * Two-step sign-in with an authenticator app (TOTP). Audit 2026-10-01, H-3.
 *
 * Optional for members, required for the people who manage a
 * tenant or the platform: AuthGate shows this before the app for them,
 * and the admin Lambdas refuse them until it is on (backend shared/mfa.ts).
 *
 * The QR code is drawn here from the library's module matrix as plain SVG,
 * so nothing is injected as HTML and the CSP needs no exception.
 */

const APP = "template.dlab5";   // the name an authenticator app shows; rename.mjs rewrites it

export function Qr({ text, size = 176 }: { text: string; size?: number }) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label="QR code" shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** The key in groups of four, easier to type than one long string. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/** QR, key and the code field: shared by the sign-in step and the setup panel. */
export function TotpEnroll({ uri, secret, busy, error, onCode }: {
  uri: string; secret: string; busy: boolean; error: string | null; onCode: (code: string) => void;
}) {
  const { t } = useT();
  const [code, setCode] = React.useState("");
  return (
    <form className="app-mfa" onSubmit={(e) => { e.preventDefault(); onCode(code.replace(/\s/g, "")); }}>
      <p className="app-muted">{t("mfa.scan")}</p>
      <div className="app-mfa__qr"><Qr text={uri} /></div>
      <p className="app-muted">{t("mfa.key")} <code className="app-mfa__key">{grouped(secret)}</code></p>
      <label className="app-field">
        <span>{t("mfa.code")}</span>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" value={code}
          onChange={(e) => setCode(e.target.value)} required />
      </label>
      {error && <p className="app-gate__error" role="alert">{error}</p>}
      <button className="app-button" type="submit" disabled={busy}>{busy ? "…" : t("mfa.enable")}</button>
    </form>
  );
}

/** Turn TOTP on for the signed-in account, then call onDone. */
export function MfaSetup({ email, onDone }: { email?: string; onDone: () => void }) {
  const [setup, setSetup] = React.useState<{ uri: string; secret: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  React.useEffect(() => {
    setUpTOTP()
      .then((d) => setSetup({ uri: d.getSetupUri(APP, email).toString(), secret: d.sharedSecret }))
      .catch(fail);
  }, [email]);

  const confirm = async (code: string) => {
    setBusy(true); setError(null);
    try {
      await verifyTOTPSetup({ code });
      await updateMFAPreference({ totp: "PREFERRED" });
      onDone();
    } catch (e) { fail(e); setBusy(false); }
  };

  if (!setup) return error ? <p className="app-gate__error" role="alert">{error}</p> : <p className="app-muted">…</p>;
  return <TotpEnroll uri={setup.uri} secret={setup.secret} busy={busy} error={error} onCode={confirm} />;
}
