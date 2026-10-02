import { defineFunction } from "@aws-amplify/backend";

// Tenants and spaces (ADR-0005): Cognito groups and their rows. AppSync
// lets any signed-in user call it; the handler decides, per operation.
export const tenants = defineFunction({
  name: "tenants",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
