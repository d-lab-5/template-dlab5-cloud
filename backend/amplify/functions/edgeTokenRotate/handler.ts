// edgeTokenRotate — POST /edge/v1/token/rotate (auth: Bearer device_token).
//
// Mints a fresh device_token and keeps the old one valid for ROTATE_GRACE_S to
// cover the request race. Same 200 success shape as /token.

import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  json,
  extractBearer,
  buildCloudEndpoints, versionGate } from "../edge-shared/http";
import {
  generateDeviceToken,
  sha256,
  DEVICE_TOKEN_TTL_S,
  POLL_INTERVAL_S,
} from "../edge-shared/codes";
import {
  ddb,
  marshall,
  verifyDeviceToken,
  EDGE_REGISTRY_TABLE,
  ROTATE_GRACE_S,
} from "../edge-shared/registry";

const SCOPE = "edge.link edge.telemetry graphs.write";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  if (!EDGE_REGISTRY_TABLE) return json(500, { error: "server_misconfigured" });

  const bearer = extractBearer(event);
  const verified = await verifyDeviceToken(bearer);
  if (!verified.ok) {
    return verified.reason === "revoked"
      ? json(410, { error: "revoked" })
      : json(401, { error: "invalid_token" });
  }
  const { row } = verified;

  const nowMs = Date.now();
  const newToken = generateDeviceToken(row.edge_id);
  const newHash = sha256(newToken);
  const oldHash = row.device_token_hash;
  const graceExpiresIso = new Date(nowMs + ROTATE_GRACE_S * 1000).toISOString();
  const tokenExpiresIso = new Date(
    nowMs + DEVICE_TOKEN_TTL_S * 1000
  ).toISOString();

  await ddb.send(
    new UpdateItemCommand({
      TableName: EDGE_REGISTRY_TABLE,
      Key: marshall({ edge_id: row.edge_id }),
      UpdateExpression:
        "SET device_token_hash = :new, device_token_expires = :exp, " +
        "previous_token_hash = :old, previous_token_expires = :grace",
      // Only rotate a token that still matches what we verified (guards a race
      // between two concurrent rotates).
      ConditionExpression: "device_token_hash = :expect",
      ExpressionAttributeValues: marshall({
        ":new": newHash,
        ":exp": tokenExpiresIso,
        ":old": oldHash,
        ":grace": graceExpiresIso,
        ":expect": oldHash,
      }),
    })
  );

  return json(200, {
    access_token: newToken,
    token_type: "Bearer",
    expires_in: DEVICE_TOKEN_TTL_S,
    edge_id: row.edge_id,
    scope: SCOPE,
    cloud_endpoints: buildCloudEndpoints(event),
    interval: POLL_INTERVAL_S,
  });
};
