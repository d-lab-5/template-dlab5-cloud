import { defineStorage } from "@aws-amplify/backend";

/**
 * Object storage for space content and static assets.
 *
 *   spaces/<spaceId>/data.json      a space's object — SOURCE OF TRUTH
 *   assets/*                        branding and icon sets
 *
 * There is deliberately NO rule for `spaces/*`. `defineStorage` rules are
 * baked in at deploy time, so they cannot express "the caller is in group
 * s-…" for a space created next month. Per-space authorization therefore
 * lives in the objectProxy function, which checks the caller's
 * `cognito:groups` against the space and its tenant and hands back a
 * short-lived presigned URL. The browser never talks to S3 directly.
 *
 * Operators (app-admins) get no rule here either: they run the platform and
 * read no tenant content (ADR-0005). An earlier version of this template gave
 * them a console-free escape hatch on all content; with tenants, that hatch
 * is exactly the access the tenancy model promises nobody has. ADR-0004.
 */
export const storage = defineStorage({
  name: "appStorage",
  access: (allow) => ({
    "assets/*": [
      allow.groups(["app-admins"]).to(["read", "write", "delete"]),
      allow.authenticated.to(["read"]),
    ],
  }),
});
