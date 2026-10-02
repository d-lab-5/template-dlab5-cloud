// HTTP helpers for the edge API Gateway (HTTP API v2) Lambdas.
//
// Carried over from digitalhome-cloud-darkfactory (DH-SPEC-100), so an edge
// made from template-dlab5-edge speaks the same wire as a digitalhome-edge box.
// The wire contract is docs/specs/edge-cloud-api.md.
//
// Wire-contract invariants the edge client enforces (do not "improve" these):
//   - Success MUST be HTTP 200 exactly. 201/204 are read as errors by the edge
//     and cause infinite backoff.
//   - RFC 8628 token errors MUST be HTTP 400 with a JSON body {"error": "..."}
//     using the exact strings authorization_pending | slow_down |
//     access_denied | expired_token.
//   - /telemetry uses 401 and 410 precisely.
//   - All bodies are JSON (the edge sends application/json, not form-encoded).
//   - An edge older than MIN_EDGE_VERSION gets 426 {"error": "edge_too_old"}
//     on every route, pairing included (versionGate).

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export function json(
  statusCode: number,
  body: unknown
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * The oldest edge this site works with. Raise it when a release fixes
 * something an older edge must not keep doing; every route then answers 426
 * to the older ones, so an edge without the fix cannot keep working.
 */
export const MIN_EDGE_VERSION = "0.1.0";

/** "1.2.3" (anything after the numbers is ignored) as comparable numbers. */
export function versionParts(v: string | undefined | null): [number, number, number] | null {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function atLeast(v: string | undefined | null, min: string = MIN_EDGE_VERSION): boolean {
  const a = versionParts(v), b = versionParts(min)!;
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** 426 for an edge that is too old or does not say its version; null when it may go on. */
export function versionGate(event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 | null {
  const got = event.headers?.["x-edge-version"];
  if (atLeast(got)) return null;
  return json(426, {
    error: "edge_too_old",
    min_version: MIN_EDGE_VERSION,
    message: `This site needs edge ${MIN_EDGE_VERSION} or newer${got ? ` (this one is ${got})` : ""}. Update the edge.`,
  });
}

// RFC 8628 error response: always HTTP 400 + {"error": "<code>"}.
export type OAuthErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_request";

export function oauthError(error: OAuthErrorCode): APIGatewayProxyResultV2 {
  return json(400, { error });
}

// Parse a JSON request body, transparently decoding base64 (API Gateway sets
// isBase64Encoded for some client encodings). Returns null on empty/invalid.
export function parseJsonBody<T = Record<string, unknown>>(
  event: APIGatewayProxyEventV2
): T | null {
  if (!event.body) return null;
  let raw = event.body;
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf-8");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Extract the bearer token from the Authorization header (case-insensitive
// header name and scheme). Returns null if absent/malformed.
export function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const headers = event.headers || {};
  const auth =
    headers.authorization ?? headers.Authorization ?? headers.AUTHORIZATION;
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

// The cloud_endpoints echoed in the token response. An edge derives them
// from its base URL too, but returning them keeps the token
// response shape of DH-SPEC-100. Base is taken from the request, so it is
// right on any stage or custom domain.
export function buildCloudEndpoints(
  event: APIGatewayProxyEventV2
): Record<string, string> {
  const domain = event.requestContext?.domainName;
  const base = domain ? `https://${domain}/edge/v1` : "/edge/v1";
  return {
    telemetry: `${base}/telemetry`,
    graphs: `${base}/graphs`,
    models: `${base}/models`,
  };
}
