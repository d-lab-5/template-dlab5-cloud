import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { objectProxy } from "../functions/objectProxy/resource";
import { tenants } from "../functions/tenants/resource";
import { graphs } from "../functions/graphs/resource";
import { edgeDeviceApproval } from "../functions/edgeDeviceApproval/resource";
import { edgeRelease } from "../functions/edgeRelease/resource";

/**
 * DynamoDB holds *metadata and structural references only*.
 *
 * A space's content is an object in S3 at `spaces/<spaceId>/data.json`, the
 * source of truth (ADR-0004); what a tenant KNOWS is an RDF A-Box per space in
 * the Graph table, synced with its edges (ADR-0007).
 *
 * TENANCY (ADR-0005). A Tenant (a family, a home, a team) holds Spaces. Both
 * are Cognito groups named like their minted ids: `t-…` are the tenant's
 * admins, `s-…` a space's readers. The `tenants` function is the only writer
 * of the rows and the groups. Operators (`app-admins`) create tenants and see
 * their names; they read no tenant content.
 *
 * KEEP IN STEP BY HAND with `packages/core/src/types.ts`. The site cannot
 * import `Schema` from this file — that would pull `@aws-amplify/backend`, and
 * graphql 15, into its TypeScript program and break the build (ADR-0001) — so
 * the frontend's copy of this shape is hand-written. Adding a field here means
 * adding it there in the same commit.
 */
const schema = a.schema({
  /**
   * A tenant. Its admins are the Cognito group named like its id. Nobody may
   * create or change the row through the generated mutations: the tenants
   * function writes it, together with the groups.
   */
  Tenant: a
    .model({
      /** Minted, never derived from the name. ADR-0003. */
      id: a.id().required(),
      name: a.string().required(),
    })
    .authorization((allow) => [
      allow.groupDefinedIn("id").to(["read"]),
      allow.group("app-admins").to(["read"]),       // operators see names, not content
    ]),

  /**
   * A space: its readers are the Cognito group named like its id (s-…). Every
   * tenant has one `shared` space, the default; admins add `private` ones.
   */
  Space: a
    .model({
      id: a.id().required(),
      tenantId: a.id().required(),
      /** A copy of the tenant's name, for display; the tenants function keeps it. */
      tenantName: a.string(),
      name: a.string().required(),
      /** "shared" (every tenant has one) or "private". */
      kind: a.string().required(),
    })
    .secondaryIndexes((index) => [index("tenantId").name("byTenant").queryField("spacesByTenant")])
    .authorization((allow) => [
      allow.groupDefinedIn("id").to(["read"]),
      allow.groupDefinedIn("tenantId").to(["read"]),
    ]),

  /**
   * A space's A-Box (ADR-0007): Turtle, validated against packages/ontology's
   * shapes, with an optimistic version. Written by saveGraph (browser) and
   * /edge/v1/graphs/put (edges), never through the generated mutations.
   */
  Graph: a
    .model({
      /** The space's id: one A-Box per space. */
      name: a.id().required(),
      spaceId: a.id(),
      tenantId: a.id(),
      ttl: a.string().required(),
      version: a.integer().required(),
      triples: a.integer(),
      updatedBy: a.string(),
    })
    .identifier(["name"])
    .authorization((allow) => [
      allow.groupDefinedIn("spaceId").to(["read"]),
      allow.groupDefinedIn("tenantId").to(["read"]),
    ]),

  GraphSaveResult: a.customType({
    status: a.string().required(),
    name: a.string().required(),
    version: a.integer(),
    problems: a.string().array(),
    currentVersion: a.integer(),
    currentTtl: a.string(),
  }),

  /** A space's A-Box (name = space id); the tenant's admins only. */
  saveGraph: a
    .mutation()
    .arguments({ name: a.string().required(), ttl: a.string().required(), baseVersion: a.integer().required() })
    .returns(a.ref("GraphSaveResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(graphs)),

  /* ---------------------------------------------------------------------- *
   * A space's object (ADR-0004).
   *
   * Custom mutations rather than generated CRUD, because the authorization
   * question — "may the caller read this space?" — cannot be expressed in a
   * static rule for a space created next month. `allow.authenticated()` here
   * means "signed in is enough to CALL this"; objectProxy then decides. Do
   * not read the rule as the boundary.
   *
   * A READ hands back a short-lived presigned GET rather than the bytes. A
   * WRITE passes the body THROUGH the function, because the correctness
   * mechanism is an S3 `If-Match` precondition and doing the PUT there means
   * the condition cannot be dropped, altered or replayed by the caller.
   * ---------------------------------------------------------------------- */

  ObjectAccess: a.customType({
    /** Presigned GET. Absent on writes and when no object exists yet. */
    url: a.string(),
    /** Current ETag — the token a subsequent write must present. */
    etag: a.string(),
    exists: a.boolean().required(),
    key: a.string().required(),
  }),

  readObject: a
    .mutation()
    .arguments({ spaceId: a.string().required() })
    .returns(a.ref("ObjectAccess"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(objectProxy)),

  writeObject: a
    .mutation()
    .arguments({
      spaceId: a.string().required(),
      /** The object to store, serialised. */
      body: a.string().required(),
      /** The ETag the caller last read; the write is refused unless S3 still holds it. */
      etag: a.string(),
      /** Set on the very first write, when there is no object to match. */
      expectAbsent: a.boolean(),
    })
    .returns(a.ref("ObjectAccess"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(objectProxy)),

  /* ---------------------------------------------------------------------- *
   * Edges (ADR-0006): the /link page and Settings → Edges. Edges themselves
   * never use AppSync; they call the edge HTTP API with a device token.
   * ---------------------------------------------------------------------- */

  DeviceCodeInfo: a.customType({
    status: a.string().required(),
    hostname: a.string(),
    lan_ip: a.string(),
    dhe_version: a.string(),
    machine_id: a.string(),
  }),

  DeviceApprovalResult: a.customType({
    status: a.string().required(),
  }),

  EdgeSummary: a.customType({
    edge_id: a.string().required(),
    machine_id: a.string(),
    hostname: a.string(),
    dhe_version: a.string(),
    status: a.string(),
    last_telemetry_at: a.string(),
    linked_at: a.string(),
    revoked_at: a.string(),
    tenant_id: a.string(),
  }),

  describeDeviceCode: a
    .query()
    .arguments({ user_code: a.string().required() })
    .returns(a.ref("DeviceCodeInfo"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(edgeDeviceApproval)),

  approveDeviceCode: a
    .mutation()
    .arguments({ user_code: a.string().required(), tenant_id: a.string().required() })
    .returns(a.ref("DeviceApprovalResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(edgeDeviceApproval)),

  denyDeviceCode: a
    .mutation()
    .arguments({ user_code: a.string().required() })
    .returns(a.ref("DeviceApprovalResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(edgeDeviceApproval)),

  listEdges: a
    .query()
    .returns(a.ref("EdgeSummary").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(edgeDeviceApproval)),

  revokeEdge: a
    .mutation()
    .arguments({ edge_id: a.string().required(), reason: a.string() })
    .returns(a.ref("EdgeSummary"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(edgeDeviceApproval)),

  /**
   * The edge installer and package for another computer: version, this site's
   * minimum edge version, and 15-minute download links with their SHA-256.
   * Tenant admins and operators (checked in the handler).
   */
  edgeRelease: a
    .query()
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(edgeRelease)),

  /* ---------------------------------------------------------------------- *
   * Managing tenants and spaces (ADR-0005). `authenticated` only says who
   * may CALL; the tenants function checks operator or tenant admin itself
   * for every operation, and two-step sign-in for all of them.
   * ---------------------------------------------------------------------- */

  Member: a.customType({
    email: a.string().required(),
    name: a.string(),
  }),

  addTenant: a
    .mutation()
    .arguments({ name: a.string().required(), adminEmail: a.string().required(), sameAs: a.string() })
    .returns(a.ref("Tenant"))
    .authorization((allow) => [allow.group("app-admins")])
    .handler(a.handler.function(tenants)),

  addSpace: a
    .mutation()
    .arguments({ tenantId: a.string().required(), name: a.string().required() })
    .returns(a.ref("Space"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(tenants)),

  renameTenant: a
    .mutation()
    .arguments({ tenantId: a.string().required(), name: a.string().required() })
    .returns(a.ref("Tenant"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(tenants)),

  renameSpace: a
    .mutation()
    .arguments({ spaceId: a.string().required(), name: a.string().required() })
    .returns(a.ref("Space"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(tenants)),

  /** group: a space id (its readers) or a tenant id (its admins). */
  groupMembers: a
    .query()
    .arguments({ group: a.string().required() })
    .returns(a.ref("Member").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(tenants)),

  addMember: a
    .mutation()
    .arguments({ group: a.string().required(), email: a.string().required() })
    .returns(a.ref("Member").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(tenants)),

  removeMember: a
    .mutation()
    .arguments({ group: a.string().required(), email: a.string().required() })
    .returns(a.ref("Member").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(tenants)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Cognito only. Edges do not use AppSync at all: they call the edge HTTP
    // API with a device token (ADR-0006). No API key, no IAM mode. ADR-0002.
    defaultAuthorizationMode: "userPool",
  },
});
