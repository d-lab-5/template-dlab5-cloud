import assert from "node:assert/strict";
import { test } from "node:test";

// Imported from dist/, not src/. That is the point of running `npm run build`
// first in the test script: these assertions run against the artefact
// packages/site actually consumes, so a broken exports map fails here rather
// than during a Gatsby build.
import {
  isMember,
  isMintedId,
  isSpace,
  mintId,
  mintSpaceId,
  mintTenantId,
  objectKeyForSpace,
  SPACE_ID,
  spaceProblems,
  spacesOf,
  TENANT_ID,
  tenantCode,
  tenantsOf,
} from "../dist/index.js";

test("a minted id carries its prefix and a fixed length", () => {
  const id = mintSpaceId();
  assert.match(id, /^s-[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
  assert.ok(isMintedId(id, "s"));
  assert.ok(!isMintedId(id, "t"), "the prefix is part of the shape");
  assert.match(mintTenantId(), TENANT_ID);
  assert.match(id, SPACE_ID);
});

test("two mints differ", () => {
  const ids = new Set(Array.from({ length: 500 }, mintSpaceId));
  assert.equal(ids.size, 500);
});

test("the alphabet excludes the characters people misread", () => {
  const ids = Array.from({ length: 200 }, mintSpaceId).join("");
  for (const banned of ["0", "1", "l", "o", "i"]) {
    assert.ok(!ids.includes(banned), `minted ids must not contain "${banned}"`);
  }
});

test("a bad prefix is refused rather than sanitised", () => {
  assert.throws(() => mintId("W"), /1-4 lowercase letters/);
  assert.throws(() => mintId(""), /1-4 lowercase letters/);
});

test("the object key is derived from the id, never from the name", () => {
  const id = mintSpaceId();
  assert.equal(objectKeyForSpace(id), `spaces/${id}/data.json`);
});

test("groups say who administers which tenant and reads which space", () => {
  const t = mintTenantId(), s = mintSpaceId();
  const groups = ["app-admins", t, s, "something-else"];
  assert.deepEqual(tenantsOf(groups), [t]);
  assert.deepEqual(spacesOf(groups), [s]);
  assert.ok(isMember([s]) && isMember([t]));
  assert.ok(!isMember(["app-admins"]), "an operator is not a member by being one");
});

test("a tenant code lists the tenant, its shared space, then private ones", () => {
  const tenant = { id: mintTenantId(), name: "Workshop" };
  const shared = { id: mintSpaceId(), tenantId: tenant.id, name: "Everyone", kind: "shared" };
  const priv = { id: mintSpaceId(), tenantId: tenant.id, name: "Team only", kind: "private" };
  assert.equal(tenantCode(tenant, [priv, shared]), `${tenant.id}/${shared.id}/${priv.id}=Team%20only`);
  assert.equal(tenantCode(tenant, [priv]), "", "no shared space visible, no code");
});

test("validation reports every problem at once", () => {
  const problems = spaceProblems({ id: "not-minted", tenantId: 3 });
  assert.ok(problems.length >= 4, `expected several problems, got ${problems}`);
  assert.ok(problems.some((p) => p.includes("id is not")));
  assert.ok(problems.some((p) => p.includes("tenantId")));
  assert.ok(problems.some((p) => p.includes("name")));
});

test("a well-formed space validates", () => {
  assert.ok(isSpace({ id: mintSpaceId(), tenantId: mintTenantId(), name: "Everyone", kind: "shared" }));
});
