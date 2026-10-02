// Shared DynamoDB client + EdgeRegistry access/verification for the edge
// device-flow Lambdas. Table names are injected as env vars in backend.ts.

import {
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { parseDeviceToken, sha256, ROTATE_GRACE_S } from "./codes";

const REGION = process.env.AWS_REGION || "eu-central-1";
export const ddb = new DynamoDBClient({ region: REGION });

export const DEVICE_CODES_TABLE = process.env.DEVICE_CODES_TABLE_NAME!;
export const EDGE_REGISTRY_TABLE = process.env.EDGE_REGISTRY_TABLE_NAME!;

export interface EdgeRow {
  edge_id: string;
  machine_id?: string;
  home_id?: string | null;
  linked_by_cognito_sub?: string;
  /** ADR-0005: every call is limited to this tenant's spaces. */
  tenant_id?: string;
  device_token_hash: string;
  device_token_expires?: string;
  previous_token_hash?: string | null;
  previous_token_expires?: string | null;
  status: "linked" | "revoked";
  first_seen_at?: string;
  last_telemetry_at?: string;
  last_heartbeat_at?: string;
  telemetry_snapshot?: Record<string, unknown>;
  delta_history?: Record<string, unknown>[];
  linked_at?: string;
  revoked_at?: string | null;
  revoked_reason?: string | null;
}

export async function getEdgeById(edgeId: string): Promise<EdgeRow | null> {
  const res = await ddb.send(
    new GetItemCommand({
      TableName: EDGE_REGISTRY_TABLE,
      Key: marshall({ edge_id: edgeId }),
    })
  );
  return res.Item ? (unmarshall(res.Item) as EdgeRow) : null;
}

export type VerifyResult =
  | { ok: true; row: EdgeRow }
  | { ok: false; reason: "unauthorized" | "revoked" };

// Resolve + authenticate a bearer device_token against EdgeRegistry.
//   - token malformed / row missing / hash mismatch → unauthorized (401)
//   - row.status === "revoked"                       → revoked (410)
// The current hash matches, OR the previous hash matches within the 60s
// post-rotation grace window (spec §3.4).
export async function verifyDeviceToken(
  token: string | null
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "unauthorized" };
  const parsed = parseDeviceToken(token);
  if (!parsed) return { ok: false, reason: "unauthorized" };

  const row = await getEdgeById(parsed.edgeId);
  if (!row) return { ok: false, reason: "unauthorized" };

  return checkToken(row, sha256(token), Date.now());
}

/** The decision itself, without the database: testable. */
export function checkToken(row: EdgeRow, hash: string, now: number): VerifyResult {
  const currentOk = row.device_token_hash === hash;
  // Old token stays valid only until previous_token_expires (60s post-rotate).
  const graceValid =
    !!row.previous_token_hash &&
    row.previous_token_hash === hash &&
    !!row.previous_token_expires &&
    Date.parse(row.previous_token_expires) > now;

  if (!currentOk && !graceValid) {
    return { ok: false, reason: "unauthorized" };
  }
  // A token lives 12 months (DEVICE_TOKEN_TTL_S); the edge rotates it well
  // before. One not rotated in time stops working: link the edge again.
  if (currentOk && row.device_token_expires && Date.parse(row.device_token_expires) <= now) {
    return { ok: false, reason: "unauthorized" };
  }
  if (row.status === "revoked") {
    return { ok: false, reason: "revoked" };
  }
  return { ok: true, row };
}

export { marshall, unmarshall, ROTATE_GRACE_S };
