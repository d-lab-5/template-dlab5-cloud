import * as React from "react";
import {
  confirmSignIn,
  fetchAuthSession,
  fetchMFAPreference,
  getCurrentUser,
  signIn,
  signOut,
  type SignInOutput,
} from "aws-amplify/auth";
import { ADMIN_GROUP, tenantsOf, isMember } from "@dlab5/app-core";
import { GuestLanding } from "./GuestLanding";
import { MfaSetup, TotpEnroll } from "./MfaSetup";
import { useAccountLang, useT } from "../lib/i18n";
import { isConfigured } from "../lib/amplify";

export interface Session {
  username: string;
  email?: string;
  /** The language saved on the account (Cognito locale), if any. */
  locale?: string;
  groups: string[];
  /** ADR-0005: an admin of at least one tenant (manages its spaces, members and edges). */
  isAdmin: boolean;
  /** The tenants this person administers (their ids are the admins' groups). */
  tenants: string[];
  /** A reader of a space or a tenant's admin: may see tenant content. */
  isMember: boolean;
  /** An operator (app-admins): runs the platform, creates tenants; reads no content unless a member too. */
  isOperator: boolean;
  /** Two-step sign-in (TOTP) is on. Required for admins and operators (H-3). */
  mfa: boolean;
}

/** The name an authenticator app shows next to the code. rename.mjs rewrites it. */
const TOTP_ISSUER = "template.dlab5";

const AuthContext = React.createContext<Session | null>(null);

/** Throws outside AuthGate, which cannot happen: AuthGate wraps every page. */
export function useSession(): Session {
  const session = React.useContext(AuthContext);
  if (!session) throw new Error("useSession used outside AuthGate");
  return session;
}

/**
 * Group changes do not reach tokens already held (constraint 7). After
 * creating a tenant or changing who is in a space, refresh and reload.
 */
export async function refreshGroups(): Promise<void> {
  await fetchAuthSession({ forceRefresh: true });
  window.location.reload();
}

async function readSession(): Promise<Session> {
  /*
   * getCurrentUser() FIRST, and separately.
   *
   * It only needs the user pool. fetchAuthSession() additionally touches the
   * identity pool, and a misconfigured identity pool should degrade the
   * session — no groups, no email — rather than drop an otherwise signed-in
   * user back to the sign-in form. Combining the two calls is the version of
   * this that looks tidier and logs people out for the wrong reason.
   */
  const user = await getCurrentUser();

  let groups: string[] = [];
  let email: string | undefined;
  let locale: string | undefined;
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload ?? {};
    groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
    email = payload.email as string | undefined;
    locale = payload.locale as string | undefined;
  } catch (err) {
    console.warn("[app] could not read auth session claims", err);
  }

  let mfa = false;
  try {
    mfa = ((await fetchMFAPreference()).enabled ?? []).includes("TOTP");
  } catch (err) {
    console.warn("[app] could not read the MFA preference", err);
  }

  return {
    username: user.username,
    mfa,
    email,
    locale,
    groups,
    isAdmin: tenantsOf(groups).length > 0,
    tenants: tenantsOf(groups),
    isMember: isMember(groups),
    isOperator: groups.includes(ADMIN_GROUP),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * A password input with a reveal toggle.
 *
 * Worth the twenty lines: an admin-provisioned password is transcribed from
 * somewhere else — an email, a terminal, a password manager — and a wrong
 * character produces the same "Incorrect username or password" as a wrong
 * account. Without a way to look, the two are indistinguishable and the user
 * retypes the same mistake.
 *
 * The button is `type="button"`. Inside a <form> the default is "submit", so
 * omitting it makes the eye submit the form — half-typed — on every click.
 *
 * It stays out of the tab order (`tabIndex={-1}`): someone tabbing from the
 * password to the submit button should reach the submit button. It is still
 * reachable by pointer and announced to a screen reader through aria-label,
 * whose text tracks the state so it says what the next press will do.
 */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [shown, setShown] = React.useState(false);
  const { t } = useT();

  return (
    <label className="app-field app-field--password" htmlFor={id}>
      <span>{label}</span>
      <span className="app-field__control">
        <input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <button
          type="button"
          className="app-field__reveal"
          onClick={() => setShown((previous) => !previous)}
          aria-pressed={shown}
          aria-label={shown ? t("auth.hidepassword") : t("auth.showpassword")}
          title={shown ? t("auth.hidepassword") : t("auth.showpassword")}
          tabIndex={-1}
        >
          {shown ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <path d="m1 1 22 22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
    </label>
  );
}

type Step = "password" | "newpassword" | "totp" | "totpsetup";

function SignInForm({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [step, setStep] = React.useState<Step>("password");
  const [setup, setSetup] = React.useState<{ uri: string; secret: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { t } = useT();

  /*
   * Cognito answers each step with the next one. Accounts are created by an
   * admin with a temporary password, so the new-password step is the NORMAL
   * first login; with two-step sign-in on, a code follows (or, the first
   * time an account must have it, its setup). Every branch matters: one left
   * out makes that sign-in fail silently.
   */
  async function next(res: SignInOutput) {
    const s = res.nextStep?.signInStep;
    if (s === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") { setStep("newpassword"); setBusy(false); return; }
    if (s === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") { setCode(""); setStep("totp"); setBusy(false); return; }
    if (s === "CONTINUE_SIGN_IN_WITH_TOTP_SETUP") {
      const d = (res.nextStep as { totpSetupDetails: { sharedSecret: string; getSetupUri: (a: string, b?: string) => URL } }).totpSetupDetails;
      setSetup({ uri: d.getSetupUri(TOTP_ISSUER, email).toString(), secret: d.sharedSecret });
      setStep("totpsetup"); setBusy(false); return;
    }
    if (s === "CONTINUE_SIGN_IN_WITH_MFA_SELECTION" || s === "CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION") {
      // only TOTP is enabled in the pool: choose it
      return next(await confirmSignIn({ challengeResponse: "TOTP" }));
    }
    if (s && s !== "DONE") throw new Error(t("auth.unsupportedstep", { step: s }));
    await onSignedIn();
  }

  async function run(fn: () => Promise<SignInOutput>) {
    setBusy(true);
    setError(null);
    try {
      await next(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (step === "newpassword") void run(() => confirmSignIn({ challengeResponse: newPassword }));
    else if (step === "totp") void run(() => confirmSignIn({ challengeResponse: code.replace(/\s/g, "") }));
    else void run(() => signIn({ username: email, password }));
  }

  if (step === "totpsetup" && setup) {
    return (
      <GuestLanding>
        <div className="app-gate__card">
          <h2 className="app-gate__title">{t("mfa.title")}</h2>
          <p className="app-gate__subtitle">{t("mfa.required")}</p>
          <TotpEnroll uri={setup.uri} secret={setup.secret} busy={busy} error={error}
            onCode={(c) => void run(() => confirmSignIn({ challengeResponse: c }))} />
        </div>
      </GuestLanding>
    );
  }

  return (
    <GuestLanding>
      <form className="app-gate__card" onSubmit={submit}>
        {/* h2, not h1: GuestLanding owns the page heading. A second h1 would
            leave the page with no single subject. */}
        <h2 className="app-gate__title">{t("auth.signin")}</h2>
        <p className="app-gate__subtitle">
          {step === "newpassword" ? t("auth.subtitle.newpassword") : step === "totp" ? t("auth.subtitle.totp") : t("auth.subtitle")}
        </p>

        {step === "newpassword" ? (
          <PasswordField
            id="app-new-password"
            label={t("auth.newpassword")}
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
          />
        ) : step === "totp" ? (
          <label className="app-field">
            <span>{t("mfa.code")}</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" value={code}
              onChange={(e) => setCode(e.target.value)} required autoFocus />
          </label>
        ) : (
          <>
            <label className="app-field">
              <span>{t("auth.email")}</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <PasswordField
              id="app-password"
              label={t("auth.password")}
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
            />
          </>
        )}

        {error && (
          <p className="app-gate__error" role="alert">
            {error}
          </p>
        )}

        <button className="app-button" type="submit" disabled={busy}>
          {busy ? t("auth.signingin") : step === "newpassword" ? t("auth.setpassword") : step === "totp" ? t("auth.confirmcode") : t("auth.signin")}
        </button>
      </form>
    </GuestLanding>
  );
}

/** Admins and operators turn on two-step sign-in before anything else (H-3). */
function MfaRequired({ session, onDone }: { session: Session; onDone: () => void }) {
  const { t } = useT();
  return (
    <GuestLanding>
      <div className="app-gate__card">
        <h2 className="app-gate__title">{t("mfa.title")}</h2>
        <p className="app-gate__subtitle">{t("mfa.required")}</p>
        <MfaSetup email={session.email} onDone={onDone} />
        <button type="button" className="app-linkbutton" onClick={() => void signOutAndReload()}>{t("nav.signout")}</button>
      </div>
    </GuestLanding>
  );
}

function Unconfigured() {
  const { t } = useT();
  return (
    <main className="app-gate">
      <div className="app-gate__card">
        <h1 className="app-gate__title">{t("auth.unconfigured")}</h1>
        <p className="app-gate__subtitle">
          This build has no <code>amplify_outputs.json</code>. Run{" "}
          <code>npm run backend:sandbox</code> then{" "}
          <code>npm run backend:sync-outputs</code>, or redeploy the branch so
          the backend phase runs.
        </p>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Gatsby renders every page at build time with no window and no Amplify. The
 * gate is the single place that knows this: during SSR it always renders the
 * neutral frame and never its children, so page components — which may call
 * useSession() freely — only ever run in the browser behind a real session.
 */
const isBrowser = typeof window !== "undefined";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"loading" | "out" | "in">("loading");
  const [session, setSession] = React.useState<Session | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);
  // the language saved on the account, unless this browser chose one (lib/i18n)
  useAccountLang(session?.locale);

  const refresh = React.useCallback(async () => {
    try {
      const next = await readSession();
      setSession(next);
      setState("in");
    } catch {
      setSession(null);
      setState("out");
    }
  }, []);

  React.useEffect(() => {
    if (!isConfigured()) return;
    void refresh();
  }, [refresh]);

  /*
   * The neutral frame is what the build emits for every page AND what the
   * client renders on its very first pass, so hydration always matches before
   * any state moves. Gating on `mounted` as well as `isBrowser` matters for
   * the unconfigured case, which would otherwise render <Unconfigured/> on the
   * client against a blank frame from the server.
   */
  if (!isBrowser || !mounted) {
    return <main className="app-gate" aria-busy="true" />;
  }

  if (!isConfigured()) return <Unconfigured />;

  // Render nothing rather than the app while we do not yet know: showing the
  // shell first and swapping it for a sign-in form is the flash of
  // authenticated content the gate exists to prevent.
  if (state === "loading") return <main className="app-gate" aria-busy="true" />;

  if (state === "out" || !session) return <SignInForm onSignedIn={refresh} />;

  if ((session.isAdmin || session.isOperator) && !session.mfa) {
    return <MfaRequired session={session} onDone={() => void refresh()} />;
  }

  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export async function signOutAndReload(): Promise<void> {
  await signOut();
  window.location.assign("/");
}

export { ADMIN_GROUP };
