import { defineBackend } from "@aws-amplify/backend";
import { Aws, CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CfnStage, CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, ProjectionType, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { objectProxy } from "./functions/objectProxy/resource";
import { tenants } from "./functions/tenants/resource";
import { graphs } from "./functions/graphs/resource";
import { edgeDeviceAuthz } from "./functions/edgeDeviceAuthz/resource";
import { edgeToken } from "./functions/edgeToken/resource";
import { edgeTokenRotate } from "./functions/edgeTokenRotate/resource";
import { edgeTelemetry } from "./functions/edgeTelemetry/resource";
import { edgeDeviceApproval } from "./functions/edgeDeviceApproval/resource";
import { edgeGraphs } from "./functions/edgeGraphs/resource";
import { edgeModels } from "./functions/edgeModels/resource";
import { edgeRelease } from "./functions/edgeRelease/resource";
import { MIN_EDGE_VERSION } from "./functions/edge-shared/http";

const backend = defineBackend({
  auth,
  data,
  storage,
  objectProxy,
  tenants,
  graphs,
  edgeDeviceAuthz,
  edgeToken,
  edgeTokenRotate,
  edgeTelemetry,
  edgeDeviceApproval,
  edgeGraphs,
  edgeModels,
  edgeRelease,
});

/* ------------------------------------------------------------------------ *
 * Auth hardening — neither switch is exposed by defineAuth.
 * ------------------------------------------------------------------------ */

const { cfnUserPool, cfnIdentityPool } = backend.auth.resources.cfnResources;

// Accounts are created by an administrator, who must also place the user in
// the right tenant and space groups. Closing self-signup at the USER POOL
// level rather than hiding it in the UI keeps that invariant true even if
// someone calls the Cognito API directly. ADR-0002.
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Nothing here is world-readable, so the identity pool refuses to vend a guest
// identity at all.
//
// Note what this does NOT do, because the comment here used to claim otherwise
// and a deploy disproved it: defineAuth still creates an unauthenticated user
// ROLE, and the flag does not remove it. Verified against a live sandbox —
// `amplifyAuthunauthenticatedUserRole` is present in the auth stack while the
// pool reports AllowUnauthenticatedIdentities=false. The role is unreachable
// because nothing can obtain credentials to assume it, which is the property
// that matters; it is not absent. Deleting it would mean dropping down to the
// L1 identity pool and rebuilding the role attachment by hand.
cfnIdentityPool.allowUnauthenticatedIdentities = false;

/* ------------------------------------------------------------------------ *
 * Point-in-time recovery.
 *
 * Tenant and Space rows are what the Cognito groups mean, and the Graph table
 * holds what each tenant knows. Losing a row orphans a group (or an A-Box)
 * nobody can now name.
 * ------------------------------------------------------------------------ */

for (const name of ["Tenant", "Space", "Graph"] as const) {
  backend.data.resources.cfnResources.amplifyDynamoDbTables[name].pointInTimeRecoveryEnabled = true;
}

const tables = backend.data.resources.tables;
const tenantTable = tables["Tenant"];
const spaceTable = tables["Space"];
const graphTable = tables["Graph"];

const allow = (fn: lambda.IFunction, actions: string[], resources: string[]) =>
  fn.addToRolePolicy(new PolicyStatement({ effect: Effect.ALLOW, actions, resources }));

/**
 * The user pool, by wildcard within this account and region. Naming it would
 * make the data stack depend on the auth stack, which already depends on
 * data: CloudFormation refuses the cycle. The real pool id comes from the
 * caller's token issuer at runtime (functions/shared/claims.ts), which is
 * authoritative anyway, since it is the pool that signed the request.
 */
const anyUserPool = (fn: lambda.IFunction) => {
  const st = Stack.of(fn);
  return `arn:${Aws.PARTITION}:cognito-idp:${st.region}:${st.account}:userpool/*`;
};

/** Read Tenant and Space: shared/spaces.ts, the one place that draws the access line. */
const spaceRead = (fn: lambda.IFunction, f: { addEnvironment: (k: string, v: string) => unknown }) => {
  allow(fn, ["dynamodb:GetItem", "dynamodb:Query"],
    [tenantTable.tableArn, spaceTable.tableArn, `${spaceTable.tableArn}/index/*`]);
  f.addEnvironment("SPACE_TABLE_NAME", spaceTable.tableName);
  f.addEnvironment("TENANT_TABLE_NAME", tenantTable.tableName);
};

/* ------------------------------------------------------------------------ *
 * objectProxy.
 *
 * Gen 2 does NOT auto-grant cross-resource IAM to a function wired as a
 * custom-mutation handler, so every permission below is explicit. This block
 * is the pattern to copy for the next function a fork adds — including the
 * habit of granting the narrowest action that does the job and saying, in a
 * comment, what the function must therefore be unable to do.
 * ------------------------------------------------------------------------ */

const bucket = backend.storage.resources.bucket;
const proxyLambda = backend.objectProxy.resources.lambda;

// Read-only on Tenant and Space: the function decides whether a caller may
// touch an object, and never edits the rows it is authorising against.
spaceRead(proxyLambda, backend.objectProxy);

// Scoped to the spaces/ prefix rather than the whole bucket. The function
// has no business reading branding assets, and will not be able to when
// someone later puts something more interesting under assets/.
allow(proxyLambda, ["s3:GetObject", "s3:PutObject"], [`${bucket.bucketArn}/spaces/*`]);

// ListBucket is required to tell "no object yet" from "not allowed".
//
// Without it S3 answers HeadObject on a missing key with 403 AccessDenied
// rather than 404 NotFound, because it will not reveal whether an object
// exists to a caller who cannot list. A space that simply has no object yet
// then looks identical to a permissions failure, and the empty state becomes
// an error screen. Granted on the BUCKET itself — ListBucket is a
// bucket-level action — and conditioned to the same prefix as the object
// grant above.
proxyLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:ListBucket"],
    resources: [bucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["spaces/*"] } },
  })
);
backend.objectProxy.addEnvironment("OBJECT_BUCKET_NAME", bucket.bucketName);

/* ------------------------------------------------------------------------ *
 * tenants (ADR-0005): the only writer of Tenant and Space rows, and of the
 * Cognito groups named like them. Every operation also requires two-step
 * sign-in (functions/shared/mfa.ts), which asks Cognito, not the token.
 * ------------------------------------------------------------------------ */

const tn = backend.tenants.resources.lambda;
allow(tn, ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],
  [tenantTable.tableArn, spaceTable.tableArn, `${spaceTable.tableArn}/index/*`]);
backend.tenants.addEnvironment("SPACE_TABLE_NAME", spaceTable.tableName);
backend.tenants.addEnvironment("TENANT_TABLE_NAME", tenantTable.tableName);
allow(tn, [
  "cognito-idp:CreateGroup", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminRemoveUserFromGroup",
  "cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser",
], [anyUserPool(tn)]);

/* ------------------------------------------------------------------------ *
 * Edge ↔ cloud registration. ADR-0006.
 *
 * The RFC 8628 device flow digitalhome.cloud uses for digitalhome-edge boxes
 * (DH-SPEC-100; the wire contract is docs/specs/edge-cloud-api.md): the edge
 * asks for a code, a tenant admin approves it on /link, and the edge receives
 * a device token bound to that tenant, which it presents as a Bearer.
 *
 * Stack placement: the pairing tables live in the DATA stack, because
 * edgeDeviceApproval (an AppSync resolver, in data) reads them and edge
 * functions (in the "edge" stack) read the data stack's tables. Data never
 * points at edge; edge points at data. Keep it so when adding an edge
 * function that writes a model of your own.
 * ------------------------------------------------------------------------ */

const dataStack = Stack.of(backend.edgeDeviceApproval.resources.lambda);
const edgeStack = Stack.of(backend.edgeDeviceAuthz.resources.lambda);

// DeviceCodes: pairing state, auto-deleted 10 minutes after creation.
const deviceCodesTable = new Table(dataStack, "DeviceCodes", {
  partitionKey: { name: "device_code", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expires_at",
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  encryption: TableEncryption.AWS_MANAGED,
});
deviceCodesTable.addGlobalSecondaryIndex({
  indexName: "byUserCode",
  partitionKey: { name: "user_code", type: AttributeType.STRING },
  projectionType: ProjectionType.KEYS_ONLY,
});

// EdgeRegistry: one row per linked edge. Holds sha256(device_token), never
// the token.
const edgeRegistryTable = new Table(dataStack, "EdgeRegistry", {
  partitionKey: { name: "edge_id", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  encryption: TableEncryption.AWS_MANAGED,
});
edgeRegistryTable.addGlobalSecondaryIndex({
  indexName: "byMachineId",
  partitionKey: { name: "machine_id", type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});

for (const fn of [backend.edgeDeviceAuthz, backend.edgeToken, backend.edgeTokenRotate, backend.edgeTelemetry,
                  backend.edgeDeviceApproval, backend.edgeGraphs, backend.edgeModels]) {
  fn.addEnvironment("DEVICE_CODES_TABLE_NAME", deviceCodesTable.tableName);
  fn.addEnvironment("EDGE_REGISTRY_TABLE_NAME", edgeRegistryTable.tableName);
}

// Where the edge's pairing link points: each deployed branch's own site, and
// the local dev server for a personal sandbox (it has no public site).
// APP_LINK_URL overrides both.
const LINK_URLS: Record<string, string> = {
  main: "https://template.dlab5.net/link",
  stage: "https://stage.template.dlab5.net/link",
};
backend.edgeDeviceAuthz.addEnvironment(
  "LINK_URL",
  process.env.APP_LINK_URL || LINK_URLS[process.env.AWS_BRANCH ?? ""] || "http://localhost:8000/link"
);

const codes = [deviceCodesTable.tableArn, `${deviceCodesTable.tableArn}/index/*`];
const registry = [edgeRegistryTable.tableArn, `${edgeRegistryTable.tableArn}/index/*`];

// The same least-privilege split as DH-SPEC-100 §8.1.
allow(backend.edgeDeviceAuthz.resources.lambda, ["dynamodb:PutItem", "dynamodb:Query"], codes);
allow(backend.edgeToken.resources.lambda, ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], [deviceCodesTable.tableArn]);
allow(backend.edgeToken.resources.lambda, ["dynamodb:PutItem", "dynamodb:Query"], registry);
for (const fn of [backend.edgeTelemetry, backend.edgeTokenRotate]) {
  allow(fn.resources.lambda, ["dynamodb:GetItem", "dynamodb:UpdateItem"], [edgeRegistryTable.tableArn]);
}
allow(backend.edgeDeviceApproval.resources.lambda, ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:UpdateItem"], codes);
allow(backend.edgeDeviceApproval.resources.lambda, ["dynamodb:Scan", "dynamodb:UpdateItem", "dynamodb:GetItem"], [edgeRegistryTable.tableArn]);
spaceRead(backend.edgeDeviceApproval.resources.lambda, backend.edgeDeviceApproval);

// A-Boxes (ADR-0007): saveGraph for the browser, edgeGraphs for edges. Both
// read and write the Graph table and nothing else; edgeGraphs also checks the
// device token.
allow(backend.graphs.resources.lambda, ["dynamodb:GetItem", "dynamodb:PutItem"], [graphTable.tableArn]);
allow(backend.edgeGraphs.resources.lambda, ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Scan"], [graphTable.tableArn]);
allow(backend.edgeGraphs.resources.lambda, ["dynamodb:GetItem"], [edgeRegistryTable.tableArn]);
allow(backend.edgeModels.resources.lambda, ["dynamodb:GetItem"], [edgeRegistryTable.tableArn]);
for (const f of [backend.graphs, backend.edgeGraphs]) {
  f.addEnvironment("GRAPH_TABLE_NAME", graphTable.tableName);
  spaceRead(f.resources.lambda, f);
}

// Admin operations require two-step sign-in: they ask Cognito whether the
// caller has TOTP set up. Wildcard pool, for the cycle described above.
for (const fn of [backend.graphs.resources.lambda, backend.edgeDeviceApproval.resources.lambda]) {
  allow(fn, ["cognito-idp:AdminGetUser"], [anyUserPool(fn)]);
}

// The HTTP API. Paths are the wire contract; they do not move.
const edgeApi = new HttpApi(edgeStack, "EdgeHttpApi", {
  apiName: "app-edge-api",
  corsPreflight: {
    allowOrigins: ["*"],
    allowMethods: [CorsHttpMethod.POST],
    allowHeaders: ["content-type", "authorization", "x-edge-version"],
  },
});
const routes: Array<[string, lambda.IFunction]> = [
  ["/edge/v1/device_authorization", backend.edgeDeviceAuthz.resources.lambda],
  ["/edge/v1/token", backend.edgeToken.resources.lambda],
  ["/edge/v1/token/rotate", backend.edgeTokenRotate.resources.lambda],
  ["/edge/v1/telemetry", backend.edgeTelemetry.resources.lambda],
  ["/edge/v1/graphs/list", backend.edgeGraphs.resources.lambda],
  ["/edge/v1/graphs/get", backend.edgeGraphs.resources.lambda],
  ["/edge/v1/graphs/put", backend.edgeGraphs.resources.lambda],
  ["/edge/v1/models", backend.edgeModels.resources.lambda],
];
for (const [path, fn] of routes) {
  edgeApi.addRoutes({
    path,
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration(`Edge${path.replace(/[^a-zA-Z0-9]/g, "")}`, fn),
  });
}
// A coarse cap on the whole surface; /token's per-code limit is in its handler.
const defaultStage = edgeApi.defaultStage?.node.defaultChild as CfnStage;
if (defaultStage) {
  defaultStage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };
}
new CfnOutput(edgeStack, "edgeApiEndpoint", {
  value: edgeApi.apiEndpoint,
  description: "Edge HTTP API: the address an edge links to",
});

/* ------------------------------------------------------------------------ *
 * The edge installer and package for another computer (Settings → Edges),
 * and the model files edges fetch on their first start.
 *
 * backend/edge-release/ is filled by the edge repository's
 * scripts/publish-to-cloud.sh and deployed here into a private bucket; the
 * edgeRelease query hands out 15-minute links to tenant admins. models/<set>/
 * is uploaded by hand (not from git) and handed to linked edges by
 * /edge/v1/models. Its own stack: the download function (data) and the edge
 * API (edge) both read it, and neither of their stacks may depend on the
 * other.
 * ------------------------------------------------------------------------ */

const EDGE_RELEASE_DIR = fileURLToPath(new URL("../edge-release", import.meta.url));
const edgeReleaseInfo = JSON.parse(readFileSync(`${EDGE_RELEASE_DIR}/release.json`, "utf8")) as { version: string };
const releaseStack = backend.createStack("edgeRelease");
const releaseBucket = new s3.Bucket(releaseStack, "EdgeReleases", {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
  removalPolicy: RemovalPolicy.DESTROY,        // copies of files in this repository, and of models
  autoDeleteObjects: true,
});
new BucketDeployment(releaseStack, "EdgeReleaseFiles", {
  sources: [Source.asset(EDGE_RELEASE_DIR)],
  destinationBucket: releaseBucket,
  prune: true,
  exclude: ["models/*"],
});
releaseBucket.grantRead(backend.edgeRelease.resources.lambda);
backend.edgeRelease.addEnvironment("EDGE_RELEASE_BUCKET", releaseBucket.bucketName);
releaseBucket.grantRead(backend.edgeModels.resources.lambda, "models/*");
backend.edgeModels.addEnvironment("EDGE_RELEASE_BUCKET", releaseBucket.bucketName);
new CfnOutput(releaseStack, "edgeReleaseBucket", { value: releaseBucket.bucketName });

/* ------------------------------------------------------------------------ *
 * In amplify_outputs.json: what the site shows on its About page and in
 * Settings → Edges. Nothing here is a credential.
 * ------------------------------------------------------------------------ */

backend.addOutput({
  custom: {
    app: {
      edgeApi: edgeApi.apiEndpoint,
      // which edges this site accepts, which it offers
      minEdgeVersion: MIN_EDGE_VERSION,
      edgeRelease: edgeReleaseInfo.version,
      environment: process.env.AWS_BRANCH ?? "sandbox",
    },
  },
});

export default backend;
