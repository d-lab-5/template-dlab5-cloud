// The Graph table: one Turtle document per A-Box, with a version that only
// moves forward. A save names the version it was based on; if the table has
// moved on, the save is refused and the current document returned, so the
// caller can merge instead of overwrite.

import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { GRAPH_NAME, validateAbox } from "./validate";

const ddb = new DynamoDBClient({});
const TABLE = () => process.env.GRAPH_TABLE_NAME!;

export interface StoredGraph {
  name: string;
  ttl: string;
  version: number;
  triples?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type SaveResult =
  | { status: "ok"; name: string; version: number; triples: number }
  | { status: "conflict"; name: string; current: StoredGraph }
  | { status: "invalid"; name: string; problems: string[] };

export class BadGraphRequest extends Error {}

export async function getGraph(name: string): Promise<StoredGraph | null> {
  if (!GRAPH_NAME.test(name)) throw new BadGraphRequest("a graph name is lowercase letters, digits and -");
  const got = await ddb.send(new GetItemCommand({ TableName: TABLE(), Key: marshall({ name }) }));
  return got.Item ? (unmarshall(got.Item) as StoredGraph) : null;
}

/** A tenant's graphs (ADR-0005: one per space, named like the space). */
export async function listGraphs(tenantId: string): Promise<Omit<StoredGraph, "ttl">[]> {
  const res = await ddb.send(new ScanCommand({
    TableName: TABLE(),
    FilterExpression: "tenantId = :h",
    ProjectionExpression: "#n, version, triples, updatedAt, updatedBy",
    ExpressionAttributeNames: { "#n": "name" },
    ExpressionAttributeValues: marshall({ ":h": tenantId }),
  }));
  return (res.Items || []).map((i) => unmarshall(i) as StoredGraph);
}

/** `scope`: the space the graph belongs to (its name is the space id) and its tenant. */
export async function saveGraph(name: string, ttl: string, baseVersion: number, by: string,
                                scope: { spaceId: string; tenantId: string }): Promise<SaveResult> {
  if (!GRAPH_NAME.test(name)) throw new BadGraphRequest("a graph name is lowercase letters, digits and -");
  if (name !== scope.spaceId) throw new BadGraphRequest("a graph is named like its space");
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new BadGraphRequest("baseVersion is the version you read, 0 for a new graph");
  const verdict = await validateAbox(ttl);
  if (!verdict.ok) return { status: "invalid", name, problems: verdict.problems };
  const now = new Date().toISOString();
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE(),
      Item: marshall({
        name, __typename: "Graph", ttl, version: baseVersion + 1, triples: verdict.triples,
        spaceId: scope.spaceId, tenantId: scope.tenantId,
        updatedAt: now, updatedBy: by, createdAt: now,
      }),
      ConditionExpression: baseVersion === 0 ? "attribute_not_exists(#n)" : "version = :base",
      ExpressionAttributeNames: baseVersion === 0 ? { "#n": "name" } : undefined,
      ExpressionAttributeValues: baseVersion === 0 ? undefined : marshall({ ":base": baseVersion }),
    }));
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
    const current = await getGraph(name);
    return { status: "conflict", name, current: current! };
  }
  return { status: "ok", name, version: baseVersion + 1, triples: verdict.triples };
}
