import { defineAuth } from "@aws-amplify/backend";

/**
 * The Cognito User Pool.
 *
 * There is no guest tier and no self-signup: the landing page IS the sign-in
 * page (ADR-0002). Accounts are created by an administrator, which is why the
 * invitation email below is the normal first-contact path rather than an edge
 * case. Self-signup is closed at the USER POOL level in backend.ts via
 * `adminCreateUserConfig` — defineAuth does not expose that switch, and
 * hiding the control in the UI would not stop a direct API call.
 *
 * Only ONE static group is declared here:
 *
 *   - app-admins   Operators. They run the platform: create tenants, see
 *                  tenant names and edges, release edges. They read NO
 *                  tenant content by being operators (ADR-0005).
 *
 * Per-tenant and per-space groups are deliberately NOT declared here. Each
 * tenant's admins are a Cognito group named like its id (`t-…`), each space's
 * readers one named like the space's (`s-…`). The `tenants` function creates
 * them at runtime together with their rows; declaring them in `defineAuth`
 * would mean a backend deploy per tenant, and Amplify's static `defineStorage`
 * rules cannot reference them anyway — which is exactly why S3 access goes
 * through the objectProxy function instead. ADR-0004, ADR-0005.
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: "CODE",
      verificationEmailSubject: "D-LAB-5 — verification code",
      verificationEmailBody: (createCode) =>
        `Your verification code is: ${createCode()}`,
      userInvitation: {
        emailSubject: "D-LAB-5 — your access",
        emailBody: (user, code) =>
          `An account has been created for you.\n\n` +
          `Username: ${user()}\n` +
          `Temporary password: ${code()}\n\n` +
          `Sign in at https://template.dlab5.net/ — you will be asked to ` +
          `choose a new password.`,
      },
    },
  },
  // Two-step sign-in with an authenticator app (TOTP). OPTIONAL in the pool,
  // so members who only look are not asked; tenant admins and operators must
  // set it up (site: AuthGate; Lambdas: functions/shared/mfa.ts).
  multifactor: { mode: "OPTIONAL", totp: true },
  groups: ["app-admins"],
  accountRecovery: "EMAIL_ONLY",
});
