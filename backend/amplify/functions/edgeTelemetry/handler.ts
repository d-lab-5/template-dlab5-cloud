// edgeTelemetry — POST /edge/v1/telemetry (auth: Bearer device_token).
//
// Carries the full welcome payload (first call) or delta heartbeats thereafter.
// The edge is identified by its token; it sends nothing that names itself.
//
// Status contract the edge enforces:
//   200 → ok (body may set poll_after_s / cbox_updated / cbox_version)
//   401 → invalid/expired token   (edge re-runs device flow)
//   410 → box revoked             (edge wipes local secrets, re-pairs)
// Any other status just makes the edge back off.

import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { json, parseJsonBody, extractBearer, versionGate } from "../edge-shared/http";
import { HEARTBEAT_POLL_S } from "../edge-shared/codes";
import {
  ddb,
  marshall,
  verifyDeviceToken,
  EDGE_REGISTRY_TABLE,
} from "../edge-shared/registry";

const MAX_DELTA_HISTORY = 20;

interface TelemetryBody {
  protocol_version?: number;
  kind?: "full" | "delta";
  client_timestamp?: string;
  [k: string]: unknown;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  if (!EDGE_REGISTRY_TABLE) return json(500, { error: "server_misconfigured" });

  const verified = await verifyDeviceToken(extractBearer(event));
  if (!verified.ok) {
    return verified.reason === "revoked"
      ? json(410, { error: "revoked" })
      : json(401, { error: "invalid_token" });
  }
  const { row } = verified;

  const body = parseJsonBody<TelemetryBody>(event) || {};
  const nowIso = new Date().toISOString();
  const isFull = body.kind === "full";

  // Build the update: always bump liveness; on a full payload snapshot it; on a
  // delta append to a capped ring of recent deltas.
  const names: Record<string, string> = { "#s": "status" };
  const values: Record<string, unknown> = {
    ":now": nowIso,
    ":linked": "linked",
  };
  const sets = ["last_telemetry_at = :now", "last_heartbeat_at = :now"];

  if (isFull) {
    names["#snap"] = "telemetry_snapshot";
    values[":snap"] = body;
    sets.push("#snap = :snap");
  } else {
    // Append delta, keeping only the most recent MAX_DELTA_HISTORY entries.
    const trimmed = [...(row.delta_history || []), body].slice(
      -MAX_DELTA_HISTORY
    );
    names["#dh"] = "delta_history";
    values[":dh"] = trimmed;
    sets.push("#dh = :dh");
  }

  await ddb.send(
    new UpdateItemCommand({
      TableName: EDGE_REGISTRY_TABLE,
      Key: marshall({ edge_id: row.edge_id }),
      UpdateExpression: `SET ${sets.join(", ")}`,
      // Defence-in-depth: only update a still-linked row.
      ConditionExpression: "#s = :linked",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values, {
        removeUndefinedValues: true,
      }),
    })
  );

  return json(200, {
    poll_after_s: HEARTBEAT_POLL_S,
    server_timestamp: nowIso,
  });
};
