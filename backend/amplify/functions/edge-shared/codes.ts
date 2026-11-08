// Shared code/token/id generation + hashing for the edge device-flow Lambdas.
// Identical to digitalhome-cloud-darkfactory's copy (DH-SPEC-100); keep it so.
//
// Wire contract (digitalhome-edge/docs/specs/edge-cloud-api.md v0.2):
//   - device_code : 128-bit secret, "dc_v1_" prefix. Never shown to the user.
//   - user_code   : 8 chars, hyphenated XXXX-XXXX, unambiguous alphabet.
//   - device_token: 256-bit secret, "dt_v1_" prefix. Returned once; only the
//                   sha256 is stored server-side.
//   - edge_id     : "e-" + uuid, durable per-box registry key.
//
// The device_token EMBEDS the edge_id (which is not a secret — it is returned
// as its own field in the same token response). This lets /telemetry and
// /token/rotate resolve the EdgeRegistry row by PK GetItem without a GSI on
// the secret hash, and makes the 60s post-rotation grace window a simple
// two-hash compare on a single row.
//
//   device_token = "dt_v1_" + <edge_id> + "." + <64 hex chars>

import { randomBytes, randomUUID, createHash } from "node:crypto";

// Lifetimes / cadence (seconds).
export const DEVICE_CODE_TTL_S = 600; // 10 min pairing window (spec §5.1)
export const DEVICE_TOKEN_TTL_S = 31536000; // 12 months (spec §3.2)
export const ROTATE_GRACE_S = 60; // old token valid 60s post-rotate (spec §3.4)
export const POLL_INTERVAL_S = 5; // min seconds between /token polls (spec §3.1)
export const HEARTBEAT_POLL_S = 60; // default telemetry cadence (spec §3.3)

// user_code alphabet — no ambiguous chars (O/0, I/1, L). Uppercase only;
// matching is case-insensitive so we normalize to uppercase on store/lookup.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateDeviceCode(): string {
  return "dc_v1_" + randomBytes(16).toString("hex"); // 128-bit
}

export function generateEdgeId(): string {
  return "e-" + randomUUID();
}

// device_token with the edge_id embedded (see header note).
export function generateDeviceToken(edgeId: string): string {
  const secret = randomBytes(32).toString("hex"); // 256-bit
  return `dt_v1_${edgeId}.${secret}`;
}

// Split a device_token back into { edgeId }. Returns null on any malformed
// input so callers can answer 401 without leaking a reason.
export function parseDeviceToken(token: string): { edgeId: string } | null {
  if (typeof token !== "string" || !token.startsWith("dt_v1_")) return null;
  const rest = token.slice("dt_v1_".length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  const edgeId = rest.slice(0, dot);
  if (!edgeId.startsWith("e-")) return null;
  return { edgeId };
}

export function generateUserCode(): string {
  const pick = () => {
    let s = "";
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) {
      s += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
    }
    return s;
  };
  return `${pick()}-${pick()}`;
}

// Normalize a user_code for storage/lookup (uppercase, keep hyphen).
export function normalizeUserCode(code: string): string {
  return (code || "").trim().toUpperCase();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
