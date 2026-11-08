import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/telemetry (auth: Bearer device_token). Full/delta heartbeat;
// updates the EdgeRegistry row and returns C-BOX freshness. IAM + env in
// backend.ts.
export const edgeTelemetry = defineFunction({
  name: "edgeTelemetry",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "edge",
});
