import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/tenant and /edge/v1/graphs/{list,get,put} (Bearer
// device_token): an edge learns its tenant and spaces, and synchronises its
// A-Boxes with this environment. Same validation and
// versioning as saveGraph. IAM + env in backend.ts.
export const edgeGraphs = defineFunction({
  name: "edgeGraphs",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 1024,
  resourceGroupName: "edge",
});
