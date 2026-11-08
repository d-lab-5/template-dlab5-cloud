import { defineFunction } from "@aws-amplify/backend";

// saveGraph (AppSync, a tenant's admins): validates a space's A-Box against
// packages/ontology's shapes and stores it with an optimistic version. ADR-0007. Reads go
// through the generated Graph queries; only writes need this function.
export const graphs = defineFunction({
  name: "graphs",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 1024,
  resourceGroupName: "data",
});
