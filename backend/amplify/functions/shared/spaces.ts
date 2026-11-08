// Tenants and spaces as the Lambdas see them (ADR-0005): who may read a
// space, who administers it, and which spaces a caller may read. One place,
// so every function draws the line the same way.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomInt } from "node:crypto";
import { TENANT, SPACE, tenantsOf, spacesOf } from "./claims";

export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const SPACE_TABLE = () => process.env.SPACE_TABLE_NAME!;
const TENANT_TABLE = () => process.env.TENANT_TABLE_NAME!;

export interface Space { id: string; tenantId: string; tenantName?: string; name: string; kind: "shared" | "private" }
export interface Tenant { id: string; name: string }

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
/** As packages/core mintId: ten characters, no 0/O, 1/l/I. */
export const mint = (prefix: "t" | "s") =>
  `${prefix}-${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

export async function getSpace(id: string): Promise<Space | null> {
  if (!SPACE.test(id)) return null;
  const r = await doc.send(new GetCommand({ TableName: SPACE_TABLE(), Key: { id } }));
  return (r.Item as Space) ?? null;
}

export async function getTenant(id: string): Promise<Tenant | null> {
  if (!TENANT.test(id)) return null;
  const r = await doc.send(new GetCommand({ TableName: TENANT_TABLE(), Key: { id } }));
  return (r.Item as Tenant) ?? null;
}

export async function spacesOfTenant(tenantId: string): Promise<Space[]> {
  const r = await doc.send(new QueryCommand({
    TableName: SPACE_TABLE(), IndexName: "byTenant",
    KeyConditionExpression: "tenantId = :h", ExpressionAttributeValues: { ":h": tenantId },
  }));
  return (r.Items as Space[]) ?? [];
}

/** Every space a caller may read: their space groups, and all spaces of the tenants they administer. */
export async function readableSpaces(groups: string[]): Promise<Space[]> {
  const out = new Map<string, Space>();
  for (const h of tenantsOf(groups)) for (const v of await spacesOfTenant(h)) out.set(v.id, v);
  for (const id of spacesOf(groups)) {
    if (out.has(id)) continue;
    const v = await getSpace(id);
    if (v) out.set(id, v);
  }
  return [...out.values()];
}

export const canRead = (groups: string[], v: Space) => groups.includes(v.id) || groups.includes(v.tenantId);
export const isAdminOf = (groups: string[], tenantId: string) => TENANT.test(tenantId) && groups.includes(tenantId);
