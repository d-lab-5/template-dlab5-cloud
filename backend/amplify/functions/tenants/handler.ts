// tenants — ADR-0005. Tenants and spaces are Cognito groups named like
// their ids (t-…: the tenant's admins, s-…: a space's readers) plus a row
// each. This is the only writer of both. (The models' own generated
// createTenant/createSpace are refused by their rules: nobody may write.)
//
//   addTenant(name, adminEmail, sameAs?)                 operators (app-admins)
//                                                        sameAs: another site's tenant code,
//                                                        so both use the same ids (see sameAsCode)
//   addSpace(tenantId, name)                          that tenant's admins
//   renameTenant(tenantId, name)                   its admins (the id stays; names are labels)
//   renameSpace(spaceId, name)                           its tenant's admins
//   groupMembers(group) / addMember / removeMember       the tenant's admins,
//                                                        for its own group and its spaces
//
// Members are existing accounts, found by e-mail: signup stays admin-only
// (ADR-0002). A tenant always keeps at least one admin.

import type { AppSyncResolverEvent } from "aws-lambda";
import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ADMIN_GROUP, TENANT, SPACE, claimsOf } from "../shared/claims";
import { MfaRequired, requireMfa } from "../shared/mfa";
import { doc, getTenant, getSpace, isAdminOf, mint, spacesOfTenant, type Space } from "../shared/spaces";

const cognito = new CognitoIdentityProviderClient({});
const SPACE_TABLE = () => process.env.SPACE_TABLE_NAME!;
const TENANT_TABLE = () => process.env.TENANT_TABLE_NAME!;

/** A refusal the caller may see. */
class Refused extends Error {}

const clean = (name: unknown, what: string) => {
  const n = String(name ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 80);
  if (!n) throw new Refused(`${what} needs a name`);
  return n;
};
const attr = (u: UserType, name: string) => u.Attributes?.find((a) => a.Name === name)?.Value;
const member = (u: UserType) => ({ email: attr(u, "email") ?? u.Username ?? "?", name: attr(u, "name") ?? null });

async function userByEmail(pool: string, email: string): Promise<UserType> {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s"@]+@[^\s"@]+$/.test(e)) throw new Refused("That is not an e-mail address.");
  const r = await cognito.send(new ListUsersCommand({ UserPoolId: pool, Filter: `email = "${e}"`, Limit: 2 }));
  const u = r.Users?.[0];
  if (!u?.Username) throw new Refused(`No account for ${e}. An operator creates accounts first.`);
  return u;
}

async function members(pool: string, group: string) {
  const out: UserType[] = [];
  let next: string | undefined;
  do {
    const r = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: pool, GroupName: group, NextToken: next }));
    out.push(...(r.Users ?? []));
    next = r.NextToken;
  } while (next);
  return out;
}

const now = () => new Date().toISOString();

async function putSpace(v: Space) {
  const t = now();
  await doc.send(new PutCommand({
    TableName: SPACE_TABLE(),
    Item: { ...v, __typename: "Space", createdAt: t, updatedAt: t },
    ConditionExpression: "attribute_not_exists(id)",
  }));
}

/** The tenant whose admins decide about this group: itself, or the space's. */
async function tenantOfGroup(group: string): Promise<string> {
  if (TENANT.test(group)) return group;
  if (SPACE.test(group)) {
    const v = await getSpace(group);
    if (v) return v.tenantId;
  }
  throw new Refused("No such tenant or space.");
}

/**
 * "The same tenant as on another site" (ADR-0005 addendum). When two sites
 * (say stage and prod) share content stored under tenant and space ids, a
 * second site that mints its own ids would have to copy everything again.
 * With the other site's code it takes the same ids instead:
 *
 *   t-xxxxxxxxxx/s-shared1234/s-private12=Team%20only/…
 *
 * the tenant, its shared space, then private spaces with their names.
 * Ids are checked for their form and must not exist on this site yet.
 */
export function parseSameAs(code: string) {
  const parts = String(code).trim().split("/").filter(Boolean);
  if (parts.length < 2 || parts.length > 21) throw new Refused("That tenant code is not complete.");
  const [hid, shared, ...rest] = parts;
  if (!TENANT.test(hid)) throw new Refused("That tenant code does not start with a tenant id.");
  if (!SPACE.test(shared)) throw new Refused("That tenant code has no shared space.");
  const privates = rest.map((p) => {
    const [id, name = ""] = p.split("=");
    if (!SPACE.test(id)) throw new Refused("That tenant code has a space id that is not one.");
    let label = "";
    try { label = decodeURIComponent(name); } catch { /* keep the fallback */ }
    return { id, name: clean(label || "A space", "A space") };
  });
  const ids = [hid, shared, ...privates.map((v) => v.id)];
  if (new Set(ids).size !== ids.length) throw new Refused("That tenant code names a space twice.");
  return { tenantId: hid, sharedSpaceId: shared, privates };
}

const exists = (e: unknown) => (e as { name?: string })?.name === "GroupExistsException";

type Args = Record<string, string | boolean | undefined>;

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const { groups, userPoolId, username } = claimsOf(event.identity);
  if (!userPoolId) throw new Error("Unauthenticated");
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const a = event.arguments;
  try {
    await requireMfa(userPoolId, username);
    if (field === "addTenant") {
      if (!groups.includes(ADMIN_GROUP)) throw new Refused("Only operators create tenants.");
      const name = clean(a.name, "A tenant");
      const admin = await userByEmail(userPoolId, String(a.adminEmail));
      const same = a.sameAs ? parseSameAs(String(a.sameAs)) : null;
      if (same) {
        if (await getTenant(same.tenantId)) throw new Refused("That tenant is already on this site.");
        for (const id of [same.sharedSpaceId, ...same.privates.map((v) => v.id)]) {
          if (await getSpace(id)) throw new Refused("A space of that tenant is already on this site.");
        }
      }
      const h = { id: same?.tenantId ?? mint("t"), name };
      const v: Space = { id: same?.sharedSpaceId ?? mint("s"), tenantId: h.id, tenantName: name, name: "Everyone", kind: "shared" };
      const privates: Space[] = (same?.privates ?? []).map((p) => ({ id: p.id, tenantId: h.id, tenantName: name, name: p.name, kind: "private" }));
      try {
        await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: h.id, Description: `Admins of ${name}` }));
        for (const x of [v, ...privates]) {
          await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: x.id, Description: `${name}: ${x.name}` }));
        }
      } catch (e) {
        if (exists(e)) throw new Refused("A group with one of those ids already exists on this site.");
        throw e;
      }
      const t = now();
      await doc.send(new PutCommand({
        TableName: TENANT_TABLE(),
        Item: { ...h, __typename: "Tenant", createdAt: t, updatedAt: t },
        ConditionExpression: "attribute_not_exists(id)",
      }));
      for (const x of [v, ...privates]) await putSpace(x);
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, GroupName: h.id, Username: admin.Username }));
      for (const x of [v, ...privates]) {
        await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, GroupName: x.id, Username: admin.Username }));
      }
      return { ...h, createdAt: t, updatedAt: t };
    }

    if (field === "addSpace") {
      const hid = String(a.tenantId || "");
      if (!isAdminOf(groups, hid)) throw new Refused("Only the tenant's admins create spaces.");
      const h = await getTenant(hid);
      if (!h) throw new Refused("No such tenant.");
      const v: Space = { id: mint("s"), tenantId: h.id, tenantName: h.name, name: clean(a.name, "A space"), kind: "private" };
      await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: v.id, Description: `${h.name}: ${v.name}` }));
      await putSpace(v);
      return { ...v, createdAt: now(), updatedAt: now() };
    }

    if (field === "renameTenant") {
      const hid = String(a.tenantId || "");
      if (!isAdminOf(groups, hid)) throw new Refused("Only the tenant's admins rename it.");
      const h = await getTenant(hid);
      if (!h) throw new Refused("No such tenant.");
      const renamed = { ...h, name: clean(a.name, "A tenant"), updatedAt: now() };
      await doc.send(new PutCommand({ TableName: TENANT_TABLE(), Item: { ...renamed, __typename: "Tenant" } }));
      // each space keeps a copy of its tenant's name, for display
      for (const v of await spacesOfTenant(hid)) {
        await doc.send(new PutCommand({ TableName: SPACE_TABLE(), Item: { ...v, tenantName: renamed.name, updatedAt: now(), __typename: "Space" } }));
      }
      return renamed;
    }

    if (field === "renameSpace") {
      const v = await getSpace(String(a.spaceId || ""));
      if (!v || !isAdminOf(groups, v.tenantId)) throw new Refused("Only the tenant's admins rename its spaces.");
      const renamed = { ...v, name: clean(a.name, "A space"), updatedAt: now() };
      await doc.send(new PutCommand({ TableName: SPACE_TABLE(), Item: { ...renamed, __typename: "Space" } }));
      return renamed;
    }

    if (field === "groupMembers" || field === "addMember" || field === "removeMember") {
      const group = String(a.group || "");
      const hid = await tenantOfGroup(group);
      if (!isAdminOf(groups, hid)) throw new Refused("Only the tenant's admins see and change who is in it.");
      if (field !== "groupMembers") {
        const u = await userByEmail(userPoolId, String(a.email));
        if (field === "addMember") {
          await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, GroupName: group, Username: u.Username }));
        } else {
          if (TENANT.test(group) && (await members(userPoolId, group)).length <= 1) {
            throw new Refused("A tenant keeps at least one admin.");
          }
          await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, GroupName: group, Username: u.Username }));
        }
      }
      return (await members(userPoolId, group)).map(member).sort((x, y) => x.email.localeCompare(y.email));
    }

    throw new Error(`Unsupported field: ${field}`);
  } catch (err) {
    if (err instanceof Refused || err instanceof MfaRequired) throw new Error(err.message);
    console.error("tenants failed", { field, err });
    throw new Error("That did not work. Try again, or tell an operator.");
  }
};
