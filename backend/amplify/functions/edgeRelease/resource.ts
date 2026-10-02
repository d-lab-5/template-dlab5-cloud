import { defineFunction } from "@aws-amplify/backend";

// The edge installer and package, as short-lived links for the people who
// set up edges (tenant admins, operators). backend/edge-release/ is
// deployed into a private bucket; scripts/publish-to-cloud.sh in the edge
// repository fills it.
export const edgeRelease = defineFunction({
  name: "edgeRelease",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "data",
});
