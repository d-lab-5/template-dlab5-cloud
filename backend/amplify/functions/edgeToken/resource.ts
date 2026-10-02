import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/token (unauth — identity proven by possession of device_code).
// RFC 8628 token endpoint. Polls for approval; on approval mints the durable
// device_token and creates the EdgeRegistry row. IAM + env wired in backend.ts.
export const edgeToken = defineFunction({
  name: "edgeToken",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "edge",
});
