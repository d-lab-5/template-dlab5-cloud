// edgeDeviceAuthz — POST /edge/v1/device_authorization (unauthenticated).
//
// RFC 8628 device authorization request. The edge calls this on first boot (or
// whenever its device-token is missing). We mint a transient device_code +
// user_code, store the caller-supplied device_info against it (TTL 10 min), and
// return the verification URI a tenant admin opens on the site to approve.
//
// Nothing here is attacker-persisted beyond a self-expiring row (spec §7.1).

import { PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { json, oauthError, parseJsonBody, versionGate } from "../edge-shared/http";
import {
  generateDeviceCode,
  generateUserCode,
  DEVICE_CODE_TTL_S,
  POLL_INTERVAL_S,
} from "../edge-shared/codes";
import { ddb, marshall, DEVICE_CODES_TABLE } from "../edge-shared/registry";

// The site's approval page (/link). Set per branch in backend.ts.
const PORTAL_LINK_URL =
  process.env.LINK_URL || "http://localhost:8000/link";

// Cap the accepted body so device_info can't be used to bloat the row (spec
// §7.2 — 4 KB body cap). Larger → 400.
const MAX_BODY_BYTES = 4096;

interface DeviceInfo {
  machine_id?: string;
  hostname?: string;
  lan_ip?: string;
  dhe_version?: string;
}
interface AuthzBody {
  client_id?: string;
  scope?: string;
  device_info?: DeviceInfo;
}

// Trim device_info to the four known fields (strings, length-capped) so we only
// persist what the approval screen needs.
function sanitizeDeviceInfo(di: DeviceInfo | undefined): DeviceInfo {
  const s = (v: unknown) =>
    typeof v === "string" ? v.slice(0, 256) : undefined;
  return {
    machine_id: s(di?.machine_id),
    hostname: s(di?.hostname),
    lan_ip: s(di?.lan_ip),
    dhe_version: s(di?.dhe_version),
  };
}

// Generate a user_code not currently live (GSI1 lookup). Best-effort: a handful
// of retries makes a collision astronomically unlikely at our scale.
async function mintUniqueUserCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateUserCode();
    const res = await ddb.send(
      new QueryCommand({
        TableName: DEVICE_CODES_TABLE,
        IndexName: "byUserCode",
        KeyConditionExpression: "user_code = :uc",
        ExpressionAttributeValues: marshall({ ":uc": code }),
        Limit: 1,
      })
    );
    if (!res.Items || res.Items.length === 0) return code;
  }
  // Extremely unlikely; fall through with a fresh code rather than fail.
  return generateUserCode();
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  if (!DEVICE_CODES_TABLE) {
    return json(500, { error: "server_misconfigured" });
  }

  if (event.body && Buffer.byteLength(event.body, "utf-8") > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }

  const body = parseJsonBody<AuthzBody>(event);
  if (!body) return oauthError("invalid_request");

  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const deviceCode = generateDeviceCode();
  const userCode = await mintUniqueUserCode();
  // TTL attribute is a unix-epoch (seconds) number for DynamoDB auto-delete.
  const expiresEpoch = Math.floor(nowMs / 1000) + DEVICE_CODE_TTL_S;

  await ddb.send(
    new PutItemCommand({
      TableName: DEVICE_CODES_TABLE,
      Item: marshall(
        {
          device_code: deviceCode,
          user_code: userCode,
          status: "pending",
          scope: typeof body.scope === "string" ? body.scope : null,
          device_info: sanitizeDeviceInfo(body.device_info),
          created_at: createdAt,
          approved_at: null,
          approved_by_sub: null,
          home_id: null,
          poll_count: 0,
          last_poll_at: null,
          expires_at: expiresEpoch,
        },
        { removeUndefinedValues: true }
      ),
      // Guard against the astronomically unlikely device_code collision.
      ConditionExpression: "attribute_not_exists(device_code)",
    })
  );

  const verificationUri = PORTAL_LINK_URL;
  const verificationUriComplete = `${PORTAL_LINK_URL}?user_code=${encodeURIComponent(
    userCode
  )}`;

  return json(200, {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: DEVICE_CODE_TTL_S,
    interval: POLL_INTERVAL_S,
  });
};
