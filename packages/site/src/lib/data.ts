import { generateClient } from "aws-amplify/api";
import type { DeviceCodeInfo, EdgeSummary, Space, Tenant } from "@dlab5/app-core";
import { tenantCode } from "@dlab5/app-core";

/**
 * The AppSync client, and everything layered on it.
 *
 * The client is deliberately UNTYPED rather than parameterised with `Schema`
 * from backend/amplify/data/resource. Importing that type would pull
 * @aws-amplify/backend into the site's TypeScript program, and with it the
 * graphql 15 tree that ADR-0001 keeps out of the frontend. The result shapes
 * below are narrow, hand-written for that reason, and MUST BE KEPT IN STEP
 * with data/resource.ts by hand. Constraint 12 in the dlab5-cloud-template skill.
 *
 * Verify the boundary still holds:
 *   npx tsc --noEmit -p packages/site/tsconfig.json --listFiles \
 *     | grep -c '@aws-amplify/backend/'      # must print 0
 *
 * Queries are written out as GraphQL strings rather than built through the
 * generated models client, for the same reason: the models client is where
 * the schema type would otherwise be needed.
 */

export type { DeviceCodeInfo, EdgeSummary, Space, Tenant };
export { tenantCode };

/** What objectProxy returns for a read or a write. */
export interface ObjectAccess {
  key: string;
  exists: boolean;
  url?: string | null;
  etag?: string | null;
}

/* -- queries --------------------------------------------------------------- */

const SPACE_FIELDS = `id tenantId tenantName name kind`;

const LIST_SPACES = /* GraphQL */ `
  query ListSpaces($nextToken: String) {
    listSpaces(limit: 500, nextToken: $nextToken) { items { ${SPACE_FIELDS} } nextToken }
  }
`;
const GET_SPACE = /* GraphQL */ `query GetSpace($id: ID!) { getSpace(id: $id) { ${SPACE_FIELDS} } }`;
const LIST_TENANTS = /* GraphQL */ `
  query ListTenants($nextToken: String) {
    listTenants(limit: 500, nextToken: $nextToken) { items { id name } nextToken }
  }
`;

const MEMBER = `email name`;
const GROUP_MEMBERS = `query GroupMembers($group: String!) { groupMembers(group: $group) { ${MEMBER} } }`;
const ADD_MEMBER = `mutation AddMember($group: String!, $email: String!) { addMember(group: $group, email: $email) { ${MEMBER} } }`;
const REMOVE_MEMBER = `mutation RemoveMember($group: String!, $email: String!) { removeMember(group: $group, email: $email) { ${MEMBER} } }`;
const CREATE_SPACE = `mutation AddSpace($tenantId: String!, $name: String!) {
  addSpace(tenantId: $tenantId, name: $name) { ${SPACE_FIELDS} } }`;
const RENAME_SPACE = `mutation RenameSpace($spaceId: String!, $name: String!) {
  renameSpace(spaceId: $spaceId, name: $name) { ${SPACE_FIELDS} } }`;
const RENAME_TENANT = `mutation RenameTenant($tenantId: String!, $name: String!) {
  renameTenant(tenantId: $tenantId, name: $name) { id name } }`;
const CREATE_TENANT = `mutation AddTenant($name: String!, $adminEmail: String!, $sameAs: String) {
  addTenant(name: $name, adminEmail: $adminEmail, sameAs: $sameAs) { id name } }`;

const EDGE_FIELDS = `edge_id machine_id hostname dhe_version status last_telemetry_at linked_at revoked_at tenant_id`;
const DESCRIBE_DEVICE_CODE = /* GraphQL */ `
  query DescribeDeviceCode($user_code: String!) {
    describeDeviceCode(user_code: $user_code) { status hostname lan_ip dhe_version machine_id }
  }
`;
const APPROVE_DEVICE_CODE = /* GraphQL */ `
  mutation ApproveDeviceCode($user_code: String!, $tenant_id: String!) {
    approveDeviceCode(user_code: $user_code, tenant_id: $tenant_id) { status }
  }
`;
const DENY_DEVICE_CODE = /* GraphQL */ `
  mutation DenyDeviceCode($user_code: String!) { denyDeviceCode(user_code: $user_code) { status } }
`;
const LIST_EDGES = /* GraphQL */ `query ListEdges { listEdges { ${EDGE_FIELDS} } }`;
const REVOKE_EDGE = /* GraphQL */ `
  mutation RevokeEdge($edge_id: String!, $reason: String) {
    revokeEdge(edge_id: $edge_id, reason: $reason) { ${EDGE_FIELDS} }
  }
`;
const EDGE_RELEASE = /* GraphQL */ `query EdgeRelease { edgeRelease }`;

const GET_GRAPH = /* GraphQL */ `
  query GetGraph($name: ID!) { getGraph(name: $name) { name ttl version updatedAt updatedBy } }
`;
const SAVE_GRAPH = /* GraphQL */ `
  mutation SaveGraph($name: String!, $ttl: String!, $baseVersion: Int!) {
    saveGraph(name: $name, ttl: $ttl, baseVersion: $baseVersion) {
      status name version problems currentVersion currentTtl
    }
  }
`;

const OBJECT_ACCESS_FIELDS = `key exists url etag`;
const READ_OBJECT = /* GraphQL */ `
  mutation ReadObject($spaceId: String!) {
    readObject(spaceId: $spaceId) { ${OBJECT_ACCESS_FIELDS} }
  }
`;
const WRITE_OBJECT = /* GraphQL */ `
  mutation WriteObject($spaceId: String!, $body: String!, $etag: String, $expectAbsent: Boolean) {
    writeObject(spaceId: $spaceId, body: $body, etag: $etag, expectAbsent: $expectAbsent) { ${OBJECT_ACCESS_FIELDS} }
  }
`;

/* -- plumbing -------------------------------------------------------------- */

interface GraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * AppSync returns errors ALONGSIDE data rather than instead of it, so a
 * caller that only reads `.data` silently drops failures. Everything goes
 * through here so that cannot happen in one call site and not another.
 */
function unwrap<T>(result: GraphQLResult<T>): T {
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  if (!result.data) throw new Error("The API returned no data.");
  return result.data;
}

const client = () => generateClient();

async function call<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let result: GraphQLResult<T>;
  try {
    result = (await client().graphql({ query, variables })) as GraphQLResult<T>;
  } catch (err) {
    // Amplify v6 REJECTS with the whole result ({ data, errors }) when a
    // resolver throws, not with an Error: unwrap it for a readable message,
    // or the page shows "[object Object]".
    if (err && typeof err === "object" && "errors" in err) result = err as GraphQLResult<T>;
    else throw err;
  }
  return unwrap(result);
}

/** Every page of a list query. */
async function all_<T>(query: string, field: string, variables: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null = null;
  do {
    const data: Record<string, { items: T[]; nextToken: string | null }> = await call(
      query, { ...variables, nextToken }
    );
    out.push(...data[field].items);
    nextToken = data[field].nextToken;
  } while (nextToken);
  return out;
}

/* -- tenants and spaces (ADR-0005) ----------------------------------------- */

/**
 * The spaces this person can see: those they read, and all spaces of the
 * tenants they administer.
 *
 * The list comes from the Space table, NOT from the user's Cognito groups.
 * AppSync applies the authorization rules server-side; deriving the list from
 * the groups looks equivalent and misses the spaces a tenant admin sees
 * through the tenant.
 */
export async function listSpaces(): Promise<Space[]> {
  const all = await all_<Space>(LIST_SPACES, "listSpaces");
  return all.sort((a, b) => (a.tenantName ?? "").localeCompare(b.tenantName ?? "")
    || (a.kind === "shared" ? -1 : b.kind === "shared" ? 1 : a.name.localeCompare(b.name)));
}

/**
 * One space's row: its NAME is what the page is titled with; under ADR-0003
 * the id in the URL is opaque and says nothing a reader can use.
 *
 * Returns null when the row does not exist OR the caller may not see it.
 * AppSync does not distinguish the two, and neither should the UI — doing so
 * would let any signed-in user enumerate space ids.
 */
export async function getSpace(id: string): Promise<Space | null> {
  return (await call<{ getSpace: Space | null }>(GET_SPACE, { id })).getSpace ?? null;
}

/** Tenants this person administers (and, for operators, all of them: names only). */
export const listTenants = () => all_<Tenant>(LIST_TENANTS, "listTenants");

export interface Member { email: string; name?: string | null }

/** group: a space id (its readers) or a tenant id (its admins). The tenant's admins only. */
export const groupMembers = async (group: string) =>
  (await call<{ groupMembers: Member[] }>(GROUP_MEMBERS, { group })).groupMembers;
export const addMember = async (group: string, email: string) =>
  (await call<{ addMember: Member[] }>(ADD_MEMBER, { group, email })).addMember;
export const removeMember = async (group: string, email: string) =>
  (await call<{ removeMember: Member[] }>(REMOVE_MEMBER, { group, email })).removeMember;
export const createSpace = async (tenantId: string, name: string) =>
  (await call<{ addSpace: Space }>(CREATE_SPACE, { tenantId, name })).addSpace;
export const renameSpace = async (spaceId: string, name: string) =>
  (await call<{ renameSpace: Space }>(RENAME_SPACE, { spaceId, name })).renameSpace;
/** Its admins; the id (and so every access) stays, only the label changes. */
export const renameTenant = async (tenantId: string, name: string) =>
  (await call<{ renameTenant: Tenant }>(RENAME_TENANT, { tenantId, name })).renameTenant;

/** Operators: a new tenant with its shared space and first admin. With
 *  `sameAs` (another site's tenant code) it takes that site's ids. */
export const createTenant = async (name: string, adminEmail: string, sameAs?: string) =>
  (await call<{ addTenant: Tenant }>(CREATE_TENANT, { name, adminEmail, sameAs: sameAs?.trim() || null })).addTenant;

/* -- edges (a tenant's admins; operators list and revoke) ------------------ */

export async function describeDeviceCode(userCode: string): Promise<DeviceCodeInfo> {
  return (await call<{ describeDeviceCode: DeviceCodeInfo }>(DESCRIBE_DEVICE_CODE, { user_code: userCode })).describeDeviceCode;
}
export async function approveDeviceCode(userCode: string, tenantId: string): Promise<string> {
  return (await call<{ approveDeviceCode: { status: string } }>(APPROVE_DEVICE_CODE, { user_code: userCode, tenant_id: tenantId }))
    .approveDeviceCode.status;
}
export async function denyDeviceCode(userCode: string): Promise<string> {
  return (await call<{ denyDeviceCode: { status: string } }>(DENY_DEVICE_CODE, { user_code: userCode })).denyDeviceCode.status;
}
export async function listEdges(): Promise<EdgeSummary[]> {
  return (await call<{ listEdges: EdgeSummary[] }>(LIST_EDGES)).listEdges;
}
export async function revokeEdge(edgeId: string, reason?: string): Promise<EdgeSummary> {
  return (await call<{ revokeEdge: EdgeSummary }>(REVOKE_EDGE, { edge_id: edgeId, reason })).revokeEdge;
}

export interface EdgeReleaseFile { name: string; sha256: string; size: number; url: string }
export interface EdgeRelease {
  version: string;
  minVersion: string;
  /** The edge's name (its install folder) and Python module, from release.json. */
  name?: string;
  module?: string;
  files: EdgeReleaseFile[];
  expiresAt: string;
}

/** The edge installer and package, as 15-minute links (tenant admins, operators). */
export async function edgeRelease(): Promise<EdgeRelease> {
  const raw = (await call<{ edgeRelease: unknown }>(EDGE_RELEASE)).edgeRelease;
  // AWSJSON arrives as a string; tolerate one encoded twice
  let v: unknown = raw;
  for (let i = 0; i < 2 && typeof v === "string"; i++) v = JSON.parse(v);
  return v as EdgeRelease;
}

/* -- A-Boxes (ADR-0007) ---------------------------------------------------- */

export interface StoredGraph {
  ttl: string;
  version: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** A space's A-Box (name = space id), or an empty one at version 0 when it does not exist yet. */
export async function loadGraph(name: string): Promise<StoredGraph> {
  const g = (await call<{ getGraph: StoredGraph | null }>(GET_GRAPH, { name })).getGraph;
  return g ?? { ttl: "", version: 0 };
}

export type SaveGraphResult =
  | { status: "ok"; version: number }
  | { status: "conflict"; currentVersion: number; currentTtl: string }
  | { status: "invalid"; problems: string[] };

/** Validated by the server against packages/ontology's shapes; versioned. The space's tenant admins. */
export async function saveGraph(name: string, ttl: string, baseVersion: number): Promise<SaveGraphResult> {
  const r = (await call<{ saveGraph: Record<string, unknown> }>(SAVE_GRAPH, { name, ttl, baseVersion })).saveGraph;
  if (r.status === "conflict") return { status: "conflict", currentVersion: r.currentVersion as number, currentTtl: (r.currentTtl as string) ?? "" };
  if (r.status === "invalid") return { status: "invalid", problems: (r.problems as string[]) ?? [] };
  return { status: "ok", version: r.version as number };
}

/* -- the object ------------------------------------------------------------ */

/**
 * Loads a space's object.
 *
 * Two hops: AppSync hands back a short-lived presigned GET, then the browser
 * fetches the bytes from S3 directly. The object never travels through
 * AppSync, which has neither the payload limits nor the pricing for it.
 *
 * The ETag comes back alongside the content because it is the token a later
 * save must present. Without it the save would have to be unconditional, and
 * objectProxy refuses those.
 */
export async function loadObject<T = unknown>(
  spaceId: string
): Promise<{ value: T | null; etag: string | null }> {
  const access = (await call<{ readObject: ObjectAccess }>(READ_OBJECT, { spaceId })).readObject;
  // A space with no object yet is a legitimate empty state, not an error.
  if (!access.exists || !access.url) return { value: null, etag: null };

  const response = await fetch(access.url);
  if (!response.ok) {
    throw new Error(`Could not read the space's object (${response.status}).`);
  }
  return { value: (await response.json()) as T, etag: access.etag ?? null };
}

/**
 * Saves a space's object.
 *
 * `etag` is what `loadObject` last returned; pass null for the first save.
 * The precondition is enforced in S3 by objectProxy, so a concurrent save
 * fails loudly rather than silently discarding someone's work. Catch the
 * error and offer a reload — the message it throws already says so.
 */
export async function saveObject(
  spaceId: string,
  value: unknown,
  etag: string | null
): Promise<string | null> {
  const access = (await call<{ writeObject: ObjectAccess }>(WRITE_OBJECT, {
    spaceId,
    body: JSON.stringify(value),
    etag: etag ?? undefined,
    expectAbsent: etag === null ? true : undefined,
  })).writeObject;
  return access.etag ?? null;
}
