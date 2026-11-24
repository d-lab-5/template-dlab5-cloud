// A space is active while an edge has read or
// written its graph in the last 14 days. Kept apart from store.ts so a
// Lambda that only asks does not carry the SHACL validator.
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({});

export const ACTIVE_DAYS = 14;

export function activeAt(seen: string | undefined | null, now: number): boolean {
  const t = seen ? Date.parse(seen) : NaN;
  return Number.isFinite(t) && now - t < ACTIVE_DAYS * 86_400_000;
}

/** Per space of a tenant, when an edge last used its graph. */
export async function edgeSeen(tenantId: string): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: process.env.GRAPH_TABLE_NAME!, FilterExpression: "tenantId = :h",
      ProjectionExpression: "#n, edgeSeenAt", ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: marshall({ ":h": tenantId }),
      ExclusiveStartKey: start as never,
    }));
    for (const i of r.Items ?? []) { const g = unmarshall(i); out[g.name] = g.edgeSeenAt; }
    start = r.LastEvaluatedKey as never;
  } while (start);
  return out;
}
