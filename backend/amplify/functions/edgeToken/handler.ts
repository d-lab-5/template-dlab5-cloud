// edgeToken — POST /edge/v1/token (unauthenticated; the device_code is the
// proof of identity).
//
// RFC 8628 token endpoint, polled by the edge every `interval` seconds after
// device_authorization. Behaviour by DeviceCodes.status:
//   - missing / expired  → 400 expired_token   (does not reveal prior existence)
//   - polled too fast     → 400 slow_down
//   - pending             → 400 authorization_pending
//   - denied              → 400 access_denied
//   - approved            → 200 with device_token + edge_id
//
// On approval we (idempotently) create/refresh the EdgeRegistry row, mint the
// device_token (storing only its sha256), and delete the consumed DeviceCodes
// row. Success MUST be HTTP 200 exactly.

import {
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  json,
  oauthError,
  parseJsonBody,
  buildCloudEndpoints, versionGate } from "../edge-shared/http";
import {
  generateEdgeId,
  generateDeviceToken,
  sha256,
  DEVICE_TOKEN_TTL_S,
  POLL_INTERVAL_S,
} from "../edge-shared/codes";
import {
  ddb,
  marshall,
  unmarshall,
  DEVICE_CODES_TABLE,
  EDGE_REGISTRY_TABLE,
} from "../edge-shared/registry";

const DEVICE_FLOW_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "edge.link edge.telemetry graphs.write";

interface TokenBody {
  grant_type?: string;
  device_code?: string;
  client_id?: string;
}

interface DeviceCodeRow {
  device_code: string;
  user_code: string;
  status: "pending" | "approved" | "denied";
  device_info?: {
    machine_id?: string;
    hostname?: string;
    lan_ip?: string;
    dhe_version?: string;
  };
  approved_by_sub?: string | null;
  /** ADR-0005: the tenant the approving admin linked this edge to. */
  tenant_id?: string | null;
  poll_count?: number;
  last_poll_at?: string | null;
  expires_at?: number; // unix epoch seconds
}

interface ExistingEdge {
  edge_id: string;
  first_seen_at?: string;
}

// One physical box (machine_id) maps to one durable edge_id. On re-pair, reuse
// the existing row so we don't orphan it.
async function findExistingEdge(
  machineId: string | undefined
): Promise<ExistingEdge | null> {
  if (!machineId) return null;
  const res = await ddb.send(
    new QueryCommand({
      TableName: EDGE_REGISTRY_TABLE,
      IndexName: "byMachineId",
      KeyConditionExpression: "machine_id = :m",
      ExpressionAttributeValues: marshall({ ":m": machineId }),
      Limit: 1,
    })
  );
  const row = (res.Items || []).map((i) => unmarshall(i))[0];
  return row
    ? {
        edge_id: row.edge_id as string,
        first_seen_at: row.first_seen_at as string | undefined,
      }
    : null;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  if (!DEVICE_CODES_TABLE || !EDGE_REGISTRY_TABLE) {
    return json(500, { error: "server_misconfigured" });
  }

  const body = parseJsonBody<TokenBody>(event);
  if (!body || body.grant_type !== DEVICE_FLOW_GRANT || !body.device_code) {
    return oauthError("invalid_request");
  }

  const got = await ddb.send(
    new GetItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: body.device_code }),
    })
  );
  // Missing (never existed OR already TTL-swept/consumed) → expired_token.
  // Deliberately identical to the true-expiry path so we don't leak existence.
  if (!got.Item) return oauthError("expired_token");
  const row = unmarshall(got.Item) as DeviceCodeRow;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Hard expiry check (TTL delete can lag by minutes).
  if (row.expires_at && nowMs / 1000 > row.expires_at) {
    return oauthError("expired_token");
  }

  // Rate limit: the edge floors polling at POLL_INTERVAL_S. If it polled faster
  // than that, answer slow_down. Always record the poll for abuse metrics.
  const lastPollMs = row.last_poll_at ? Date.parse(row.last_poll_at) : 0;
  const tooFast = lastPollMs > 0 && nowMs - lastPollMs < POLL_INTERVAL_S * 1000;
  await ddb.send(
    new UpdateItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: body.device_code }),
      UpdateExpression:
        "SET last_poll_at = :now ADD poll_count :one",
      ExpressionAttributeValues: marshall({ ":now": nowIso, ":one": 1 }),
    })
  );
  if (tooFast) return oauthError("slow_down");

  if (row.status === "pending") return oauthError("authorization_pending");
  if (row.status === "denied") return oauthError("access_denied");
  // status === "approved" falls through.

  const approvedBy = row.approved_by_sub;
  if (!approvedBy) {
    // Approved flag set but no approver captured — not yet usable.
    return oauthError("authorization_pending");
  }

  const machineId = row.device_info?.machine_id;
  const existing = await findExistingEdge(machineId);
  const edgeId = existing?.edge_id || generateEdgeId();

  const deviceToken = generateDeviceToken(edgeId);
  const tokenHash = sha256(deviceToken);
  const tokenExpiresIso = new Date(
    nowMs + DEVICE_TOKEN_TTL_S * 1000
  ).toISOString();

  // Upsert the durable registry row. Preserve first_seen_at across re-pairs.
  await ddb.send(
    new PutItemCommand({
      TableName: EDGE_REGISTRY_TABLE,
      Item: marshall(
        {
          edge_id: edgeId,
          // machine_id is a GSI partition key: OMIT it when absent (marshall
          // drops `undefined`), because a NULL-typed key fails the write.
          machine_id: machineId || undefined,
          linked_by_cognito_sub: approvedBy,
          tenant_id: row.tenant_id || undefined,
          // device_info snapshot so the Portal can show the box before its
          // first telemetry lands.
          hostname: row.device_info?.hostname || null,
          lan_ip: row.device_info?.lan_ip || null,
          dhe_version: row.device_info?.dhe_version || null,
          device_token_hash: tokenHash,
          device_token_expires: tokenExpiresIso,
          previous_token_hash: null,
          previous_token_expires: null,
          status: "linked",
          first_seen_at: existing?.first_seen_at || nowIso,
          last_telemetry_at: null,
          last_heartbeat_at: null,
          linked_at: nowIso,
          revoked_at: null,
          revoked_reason: null,
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  // Consume the pairing code so it can't be replayed.
  await ddb.send(
    new DeleteItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Key: marshall({ device_code: body.device_code }),
    })
  );

  return json(200, {
    access_token: deviceToken,
    token_type: "Bearer",
    expires_in: DEVICE_TOKEN_TTL_S,
    edge_id: edgeId,
    scope: SCOPE,
    cloud_endpoints: buildCloudEndpoints(event),
    interval: POLL_INTERVAL_S,
  });
};
