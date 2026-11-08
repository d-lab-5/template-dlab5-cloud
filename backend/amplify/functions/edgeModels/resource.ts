import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/models {set} (Bearer device_token): short-lived links to a
// set of files a linked edge fetches on its first start (AI models, say),
// with the SHA-256 the edge checks them against. The files are uploaded by
// hand to models/<set>/ of the edge release bucket, with a manifest.json;
// they are not public anywhere. IAM + env in backend.ts.
export const edgeModels = defineFunction({
  name: "edgeModels",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "edge",
});
