/**
 * The name an authenticator app shows for this site's two-step sign-in: the
 * product and its environment, "template.dlab5 prod" or "template.dlab5 stage", so a
 * busy authenticator tells stage from prod, and one product from the next.
 *
 * The environment comes from the address the page is served at: a host that
 * starts with stage., dev., test., qa., sandbox. or preview.; Amplify's branch
 * host (main is prod); localhost is dev; anything else is prod. The label
 * holds no ids, tenant or account: anyone holding the phone sees it. No
 * colon either: the setup URI is otpauth://totp/<issuer>:<account>.
 *
 * Only a new setup takes the name; an entry made earlier keeps its old one
 * (rename it in the authenticator app).
 */
export const PRODUCT = "template.dlab5";
const NAMED = /^(stage|staging|dev|test|qa|sandbox|preview)$/;

export function environment(host = typeof window === "undefined" ? "" : window.location.hostname): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || /^(127\.|\[?::1\]?$)/.test(h)) return "dev";
  const first = h.split(".")[0];
  if (h.endsWith(".amplifyapp.com")) return first === "main" ? "prod" : first.replace(/[^a-z0-9-]/g, "").slice(0, 20) || "prod";
  return NAMED.test(first) ? (first === "staging" ? "stage" : first) : "prod";
}

export const totpIssuer = (host?: string) => `${PRODUCT} ${environment(host)}`;
