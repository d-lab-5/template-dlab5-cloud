// edgeDeviceApproval — AppSync resolver for edge pairing.
//
// Dispatches on the field name:
//   describeDeviceCode(user_code)   device_info for the /link screen
//   approveDeviceCode(user_code, tenant_id)
//                                   links the edge to that tenant (ADR-0005)
//   denyDeviceCode(user_code)       rejects the pairing
//   listEdges                       the edges of the caller's tenants
//                                   (operators: every edge)
//   revokeEdge(edge_id)             the edge's next call gets 410 and re-pairs
//
// Trust anchor: the Cognito login of a tenant admin (operators may list
// and revoke, never link an edge into a tenant). The wire and the
// DynamoDB shapes are DH-SPEC-100's, with the SmartHome generalized to a tenant.

import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { AppSyncResolverEvent } from "aws-lambda";
import { ADMIN_GROUP, claimsOf, tenantsOf } from "../shared/claims";
import { getTenant, isAdminOf } from "../shared/spaces";
import { requireMfa } from "../shared/mfa";

const DEVICE_CODES_TABLE = process.env.DEVICE_CODES_TABLE_NAME!;
const EDGE_REGISTRY_TABLE = process.env.EDGE_REGISTRY_TABLE_NAME!;

const ddb = new DynamoDBClient({});

interface Args {
  user_code?: string;
  tenant_id?: string;
  edge_id?: string;
  reason?: string;
}
interface DeviceInfo {
  machine_id?: string;
  hostname?: string;
  lan_ip?: string;
  dhe_version?: string;
}

async function findByUserCode(userCode: string) {
  const idx = await ddb.send(new QueryCommand({
    TableName: DEVICE_CODES_TABLE,
    IndexName: "byUserCode",
    KeyConditionExpression: "user_code = :uc",
    ExpressionAttributeValues: marshall({ ":uc": userCode }),
    Limit: 1,
  }));
  if (!idx.Items?.length) return null;
  const { device_code } = unmarshall(idx.Items[0]);
  const res = await ddb.send(new GetItemCommand({
    TableName: DEVICE_CODES_TABLE,
    Key: marshall({ device_code }),
  }));
  if (!res.Item) return null;
  const row = unmarshall(res.Item);
  return {
    device_code: row.device_code as string,
    status: row.status as string,
    device_info: (row.device_info as DeviceInfo) || {},
  };
}

function toEdgeSummary(row: Record<string, unknown>) {
  return {
    edge_id: row.edge_id as string,
    machine_id: (row.machine_id as string) ?? null,
    hostname: (row.hostname as string) ?? null,
    dhe_version: (row.dhe_version as string) ?? null,
    status: (row.status as string) ?? null,
    last_telemetry_at: (row.last_telemetry_at as string) ?? null,
    linked_at: (row.linked_at as string) ?? null,
    revoked_at: (row.revoked_at as string) ?? null,
    tenant_id: (row.tenant_id as string) ?? null,
  };
}

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  if (!DEVICE_CODES_TABLE || !EDGE_REGISTRY_TABLE) throw new Error("Server misconfigured");

  const { groups, username, userPoolId } = claimsOf(event.identity);
  const sub = (event.identity as { sub?: string } | undefined)?.sub ?? username;
  if (!sub) throw new Error("Unauthenticated");
  const operator = groups.includes(ADMIN_GROUP);
  const mine = tenantsOf(groups);
  if (!operator && !mine.length) throw new Error("Only a tenant's admins may manage its edges");
  await requireMfa(userPoolId, username);

  // Gen 2 puts the operation name at the TOP LEVEL (event.fieldName) and leaves
  // event.info empty; darkfactory learned this the hard way.
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const nowIso = new Date().toISOString();

  if (field === "listEdges") {
    // A tenant has a handful of edges; a Scan is honest about that.
    const res = await ddb.send(new ScanCommand({ TableName: EDGE_REGISTRY_TABLE }));
    return (res.Items || []).map((i) => toEdgeSummary(unmarshall(i)))
      .filter((e) => operator || (e.tenant_id !== null && mine.includes(e.tenant_id)))
      .sort((a, b) => String(b.linked_at).localeCompare(String(a.linked_at)));
  }

  if (field === "revokeEdge") {
    const edgeId = (event.arguments.edge_id || "").trim();
    if (!edgeId) throw new Error("edge_id is required");
    if (!operator) {
      const got = await ddb.send(new GetItemCommand({ TableName: EDGE_REGISTRY_TABLE, Key: marshall({ edge_id: edgeId }) }));
      const hid = got.Item ? (unmarshall(got.Item).tenant_id as string | undefined) : undefined;
      if (!hid || !mine.includes(hid)) throw new Error("Only that tenant's admins may revoke this edge");
    }
    const res = await ddb.send(new UpdateItemCommand({
      TableName: EDGE_REGISTRY_TABLE,
      Key: marshall({ edge_id: edgeId }),
      UpdateExpression: "SET #s = :revoked, revoked_at = :now, revoked_reason = :why",
      ConditionExpression: "attribute_exists(edge_id)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: marshall({
        ":revoked": "revoked", ":now": nowIso,
        ":why": (event.arguments.reason || "revoked by an admin").slice(0, 200),
      }),
      ReturnValues: "ALL_NEW",
    }));
    return toEdgeSummary(unmarshall(res.Attributes!));
  }

  const userCode = (event.arguments.user_code || "").trim().toUpperCase();
  if (!userCode) throw new Error("user_code is required");
  const pending = await findByUserCode(userCode);
  if (!pending) throw new Error("No pending edge found for that code");

  if (field === "describeDeviceCode") {
    const di = pending.device_info;
    return {
      status: pending.status,
      hostname: di.hostname ?? null,
      lan_ip: di.lan_ip ?? null,
      dhe_version: di.dhe_version ?? null,
      machine_id: di.machine_id ?? null,
    };
  }

  if (pending.status !== "pending") throw new Error(`Code already ${pending.status}`);

  const approve = field === "approveDeviceCode";
  if (!approve && field !== "denyDeviceCode") throw new Error(`Unsupported field: ${field}`);
  const tenantId = (event.arguments.tenant_id || "").trim();
  if (approve) {
    // linking an edge into a tenant lets it write that tenant's spaces
    if (!isAdminOf(groups, tenantId)) throw new Error("Only that tenant's admins may link an edge to it");
    if (!(await getTenant(tenantId))) throw new Error("No such tenant");
  }
  await ddb.send(new UpdateItemCommand({
    TableName: DEVICE_CODES_TABLE,
    Key: marshall({ device_code: pending.device_code }),
    UpdateExpression: approve
      ? "SET #s = :to, approved_by_sub = :sub, approved_at = :now, tenant_id = :h"
      : "SET #s = :to",
    ConditionExpression: "#s = :pending",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: marshall(approve
      ? { ":to": "approved", ":sub": sub, ":now": nowIso, ":pending": "pending", ":h": tenantId }
      : { ":to": "denied", ":pending": "pending" }),
  }));
  return { status: approve ? "approved" : "denied" };
};
