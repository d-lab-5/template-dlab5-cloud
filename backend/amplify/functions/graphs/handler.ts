// saveGraph(name, ttl, baseVersion): a space's A-Box (name = space id), by
// that space's tenant admins only (ADR-0005). This is the boundary; the
// AppSync rule only requires a signed-in caller.
import type { AppSyncResolverEvent } from "aws-lambda";
import { claimsOf } from "../shared/claims";
import { getSpace, isAdminOf } from "../shared/spaces";
import { requireMfa } from "../shared/mfa";
import { BadGraphRequest, saveGraph } from "../graph-shared/store";

interface Args { name: string; ttl: string; baseVersion: number }

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const { groups, username, userPoolId } = claimsOf(event.identity);
  const { name, ttl, baseVersion } = event.arguments;
  const space = await getSpace(name);
  if (!space || !isAdminOf(groups, space.tenantId)) throw new Error("Only the tenant's admins may change this A-Box");
  await requireMfa(userPoolId, username);
  try {
    const r = await saveGraph(name, ttl, baseVersion, `user:${username}`, { spaceId: space.id, tenantId: space.tenantId });
    if (r.status === "conflict") {
      return { status: "conflict", name, currentVersion: r.current.version, currentTtl: r.current.ttl, problems: [] };
    }
    if (r.status === "invalid") return { status: "invalid", name, problems: r.problems };
    return { status: "ok", name, version: r.version, problems: [] };
  } catch (err) {
    if (err instanceof BadGraphRequest) throw new Error(err.message);
    console.error("saveGraph failed", err);
    throw new Error("Saving the A-Box failed");
  }
};
