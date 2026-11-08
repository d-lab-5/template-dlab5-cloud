import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/device_authorization (unauth) — RFC 8628 device authorization
// request. Mints a device_code + user_code and writes a short-lived
// DeviceCodes row. IAM + env wired in backend.ts.
export const edgeDeviceAuthz = defineFunction({
  name: "edgeDeviceAuthz",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  // Colocate all edge HTTP Lambdas + their tables + the HTTP API in one nested
  // stack to avoid cross-stack circular deps (the API references the Lambdas
  // and the Lambdas reference the tables).
  resourceGroupName: "edge",
});
