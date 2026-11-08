import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/token/rotate (auth: Bearer device_token). Rolling refresh; the
// old token stays valid for a 60s grace window. IAM + env in backend.ts.
//
// Note: today's edge client does not call this yet (a 401 triggers a full
// re-pair instead) — implemented for forward-compatibility per spec §3.4.
export const edgeTokenRotate = defineFunction({
  name: "edgeTokenRotate",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "edge",
});
