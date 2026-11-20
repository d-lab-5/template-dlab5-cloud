// The Graph table: one Turtle document per A-Box, with a version that only
// moves forward. A save names the version it was based on; if the table has
// moved on, the save is refused and the current document returned, so the
// caller can merge instead of overwrite.

import { DynamoDBClient, GetItemCommand, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
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
  /** an edge's use (see activity.ts): the last time an edge read or wrote it, and which. */
  edgeSeenAt?: string;
  edgeSeenBy?: string;
  edgeSeenName?: string;
}

/** An edge that touches a graph: its id and, if it said, its host name. */
export interface EdgeTouch { id: string; name?: string | null }

/** A touch is recorded at most this often per graph. */
export const TOUCH_EVERY_MS = 60 * 60 * 1000;

/** Whether a touch now should be written, given the last one (pure; tested). */
export function touchDue(last: string | undefined, now: number): boolean {
  if (!last) return true;
  const t = Date.parse(last);
  return !Number.isFinite(t) || now - t >= TOUCH_EVERY_MS;
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
    ProjectionExpression: "#n, version, triples, updatedAt, updatedBy, edgeSeenAt, edgeSeenName",
    ExpressionAttributeNames: { "#n": "name" },
    ExpressionAttributeValues: marshall({ ":h": tenantId }),
  }));
  return (res.Items || []).map((i) => unmarshall(i) as StoredGraph);
}

/** `scope`: the space the graph belongs to (its name is the space id) and its
 * tenant. An UpdateItem, not a Put, so what else the row holds (an edge's
 * last touch) is kept; an edge's save is itself a touch. */
export async function saveGraph(name: string, ttl: string, baseVersion: number, by: string,
                                scope: { spaceId: string; tenantId: string }, edge?: EdgeTouch): Promise<SaveResult> {
  if (!GRAPH_NAME.test(name)) throw new BadGraphRequest("a graph name is lowercase letters, digits and -");
  if (name !== scope.spaceId) throw new BadGraphRequest("a graph is named like its space");
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new BadGraphRequest("baseVersion is the version you read, 0 for a new graph");
  const verdict = await validateAbox(ttl);
  if (!verdict.ok) return { status: "invalid", name, problems: verdict.problems };
  const now = new Date().toISOString();
  const values: Record<string, unknown> = {
    ":ttl": ttl, ":v": baseVersion + 1, ":tr": verdict.triples, ":sp": scope.spaceId, ":te": scope.tenantId,
    ":now": now, ":by": by, ":tn": "Graph",
  };
  let set = "ttl = :ttl, version = :v, triples = :tr, spaceId = :sp, tenantId = :te, updatedAt = :now, " +
    "updatedBy = :by, __typename = :tn, createdAt = if_not_exists(createdAt, :now)";
  if (edge) {
    set += ", edgeSeenAt = :now, edgeSeenBy = :eb, edgeSeenName = :en";
    Object.assign(values, { ":eb": `edge:${edge.id}`, ":en": edge.name || "" });
  }
  if (baseVersion !== 0) values[":base"] = baseVersion;
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TABLE(),
      Key: marshall({ name }),
      UpdateExpression: "SET " + set,
      ConditionExpression: baseVersion === 0 ? "attribute_not_exists(#n)" : "version = :base",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: marshall(values),
    }));
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
    const current = await getGraph(name);
    return { status: "conflict", name, current: current! };
  }
  return { status: "ok", name, version: baseVersion + 1, triples: verdict.triples };
}

/** An edge read the graph: note it, at most once an hour, and only on a graph
 * that exists (an edge reading an empty space has not used it yet). */
export async function touchGraph(name: string, edge: EdgeTouch, current?: StoredGraph | null): Promise<boolean> {
  const now = Date.now();
  if (!current || !touchDue(current.edgeSeenAt, now)) return false;
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TABLE(),
      Key: marshall({ name }),
      UpdateExpression: "SET edgeSeenAt = :now, edgeSeenBy = :eb, edgeSeenName = :en",
      ConditionExpression: "attribute_exists(#n) AND (attribute_not_exists(edgeSeenAt) OR edgeSeenAt < :due)",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: marshall({ ":now": new Date(now).toISOString(), ":eb": `edge:${edge.id}`,
        ":en": edge.name || "", ":due": new Date(now - TOUCH_EVERY_MS).toISOString() }),
    }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}
