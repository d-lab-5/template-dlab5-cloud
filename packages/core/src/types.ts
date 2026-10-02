/**
 * The shapes both sides of the app agree on.
 *
 * This module is the ONE place the Tenant and Space shapes are written down
 * for the frontend. It is deliberately hand-written rather than derived from
 * the Amplify schema: importing `Schema` from `backend/amplify/data/resource`
 * would pull `@aws-amplify/backend` — and with it graphql 15 — into the site's
 * TypeScript program, which is the thing ADR-0001 exists to prevent.
 *
 * The cost of that is real and worth naming: this file and
 * `backend/amplify/data/resource.ts` must be kept in step BY HAND. When you
 * add a field to a model, add it here in the same commit.
 */

/**
 * A tenant (ADR-0005): a family, a home, a team. Its admins are the Cognito
 * group named like its id. `id` is minted (ADR-0003): `t-` plus ten
 * characters. Never render it where a name belongs.
 */
export interface Tenant {
  id: string;
  name: string;
}

/**
 * A space of a tenant: its readers are the Cognito group named like its id
 * (`s-…`). Every tenant has one `shared` space; its admins add `private` ones.
 * The space's content is one object in S3 (ADR-0004); what the tenant knows
 * about it is an A-Box named like the space (ADR-0007).
 */
export interface Space {
  id: string;
  tenantId: string;
  /** A copy of the tenant's name, for display. */
  tenantName?: string | null;
  name: string;
  kind: "shared" | "private" | string;
}

/** An edge registered through the device flow. ADR-0006. */
export interface EdgeSummary {
  edge_id: string;
  machine_id?: string | null;
  hostname?: string | null;
  dhe_version?: string | null;
  status?: string | null;
  last_telemetry_at?: string | null;
  linked_at?: string | null;
  revoked_at?: string | null;
  /** The tenant it was linked to. */
  tenant_id?: string | null;
}

/** What /link shows about an edge asking to be linked. */
export interface DeviceCodeInfo {
  status: string;
  hostname?: string | null;
  lan_ip?: string | null;
  dhe_version?: string | null;
  machine_id?: string | null;
}

/** Operators. Change it here and in auth/resource.ts together. */
export const ADMIN_GROUP = "app-admins";

/** ADR-0005: a tenant's admins and a space's readers are groups named like their ids. */
export const TENANT_ID = /^t-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const SPACE_ID = /^s-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
export const tenantsOf = (groups: readonly string[]) => groups.filter((g) => TENANT_ID.test(g));
export const spacesOf = (groups: readonly string[]) => groups.filter((g) => SPACE_ID.test(g));

/** May this person see any tenant content? A reader of a space, or a tenant's admin. */
export const isMember = (groups: readonly string[]): boolean =>
  tenantsOf(groups).length > 0 || spacesOf(groups).length > 0;

/** `spaces/s-4k9mqhtx2p/data.json` — where a space's object lives in S3. */
export const objectKeyForSpace = (spaceId: string): string => `spaces/${spaceId}/data.json`;

/**
 * The code another site takes to be the same tenant (ADR-0005 addendum):
 * tenant / shared space / private spaces with their names, e.g.
 * `t-…/s-…/s-…=Team%20only`. Empty when the shared space is not visible.
 */
export function tenantCode(tenant: Tenant, spaces: readonly Space[]): string {
  const own = spaces.filter((s) => s.tenantId === tenant.id);
  const shared = own.find((s) => s.kind === "shared");
  if (!shared) return "";
  const privates = own.filter((s) => s.kind === "private").map((s) => `${s.id}=${encodeURIComponent(s.name)}`);
  return [tenant.id, shared.id, ...privates].join("/");
}
