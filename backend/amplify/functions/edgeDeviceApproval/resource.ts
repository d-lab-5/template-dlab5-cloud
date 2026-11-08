import { defineFunction } from "@aws-amplify/backend";

// Backs the /link page and the "Edges" list in Settings (AppSync, Cognito).
// Same role as digitalhome-cloud-darkfactory's edgeDeviceApproval, with the
// SmartHome generalized to a tenant: a tenant's admins link, list and revoke
// its edges; operators list and revoke. IAM + env in backend.ts.
export const edgeDeviceApproval = defineFunction({
  name: "edgeDeviceApproval",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "data",
});
