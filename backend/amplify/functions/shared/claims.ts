import type { AppSyncIdentityCognito } from "aws-lambda";

/**
 * What a caller's token says about them.
 *
 * Every function that gates on group membership reads it through here, so
 * there is one place that knows the awkward part: a token carrying a single
 * group can arrive as a bare string rather than a one-element array, and a
 * naive `Array.isArray` check silently treats such a caller as having no
 * groups at all. That failure looks exactly like a permissions bug.
 */
export function claimsOf(identity: unknown) {
  const cognito = identity as AppSyncIdentityCognito | undefined;
  const claim = cognito?.claims?.["cognito:groups"];
  const groups = Array.isArray(claim)
    ? (claim as string[])
    : typeof claim === "string"
      ? claim.split(/[\s,]+/).filter(Boolean)
      : [];

  return {
    groups,
    username: cognito?.username ?? (cognito?.claims?.sub as string | undefined),
    /**
     * The user pool is recovered from the token's ISSUER rather than passed in
     * an environment variable.
     *
     * An env var would mean referencing the auth stack from the data stack,
     * which closes a CloudFormation cycle — and the issuer is authoritative
     * anyway, since it is the pool that actually signed this request. Nothing
     * in this template needs it yet; it is here because the first function a
     * fork adds that calls the Cognito API will, and rediscovering this costs
     * a failed deploy.
     */
    userPoolId: (cognito?.issuer ?? "").split("/").pop(),
  };
}

/** Operators: run the platform, create tenants, read no tenant content. */
export const ADMIN_GROUP = "app-admins";

/** ADR-0005: a tenant's admins are the Cognito group named like its id … */
export const TENANT = /^t-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
/** … and a space's readers the group named like the space's id. */
export const SPACE = /^s-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

export const tenantsOf = (groups: string[]) => groups.filter((g) => TENANT.test(g));
export const spacesOf = (groups: string[]) => groups.filter((g) => SPACE.test(g));
