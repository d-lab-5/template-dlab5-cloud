// The edge side of A-Box sync (phase 3a). An edge reads a graph with its
// version, merges locally statement by statement against the version it
// last synced, and writes back naming the version it read. If someone saved
// meanwhile, it gets 409 and the current document, and merges again.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { extractBearer, json, parseJsonBody, versionGate } from "../edge-shared/http";
import { verifyDeviceToken } from "../edge-shared/registry";
import { BadGraphRequest, getGraph, listGraphs, saveGraph } from "../graph-shared/store";
import { getSpace } from "../shared/spaces";

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  const verified = await verifyDeviceToken(extractBearer(event));
  if (!verified.ok) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const body = parseJsonBody<{ name?: string; ttl?: string; baseVersion?: number }>(event) || {};
  // ADR-0005: an edge reaches only its own tenant's graphs (one per space)
  const tenant = verified.row.tenant_id;
  if (!tenant) return json(403, { error: "no_tenant", message: "this edge belongs to no tenant yet; link it again" });
  try {
    if (event.rawPath.endsWith("/graphs/list")) return json(200, { graphs: await listGraphs(tenant) });
    const space = await getSpace(String(body.name || ""));
    if (!space || space.tenantId !== tenant) return json(404, { error: "not_found", message: "no such space in this tenant" });
    if (event.rawPath.endsWith("/graphs/get")) {
      const g = await getGraph(space.id);
      return json(200, g ?? { name: space.id, version: 0, ttl: "" });
    }
    if (event.rawPath.endsWith("/graphs/put")) {
      if (typeof body.ttl !== "string") return json(400, { error: "invalid_request", message: "ttl is required" });
      const r = await saveGraph(space.id, body.ttl, Number(body.baseVersion ?? -1),
        `edge:${verified.row.edge_id}`, { spaceId: space.id, tenantId: tenant });
      if (r.status === "conflict") return json(409, { error: "version_conflict", current: r.current });
      if (r.status === "invalid") return json(422, { error: "invalid", problems: r.problems });
      return json(200, r);
    }
    return json(404, { error: "not_found" });
  } catch (err) {
    if (err instanceof BadGraphRequest) return json(400, { error: "invalid_request", message: err.message });
    console.error("edgeGraphs failed", { edge: verified.row.edge_id, err });
    return json(500, { error: "server_error" });
  }
};
