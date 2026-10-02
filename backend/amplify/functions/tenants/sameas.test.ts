import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSameAs } from "./handler";

// A tenant code from another site (ADR-0005 addendum): the same ids here.

test("a code names the tenant, its shared space and private spaces", () => {
  const s = parseSameAs("t-aaaaaaaaaa/s-bbbbbbbbbb/s-cccccccccc=Team%20only/s-dddddddddd");
  assert.equal(s.tenantId, "t-aaaaaaaaaa");
  assert.equal(s.sharedSpaceId, "s-bbbbbbbbbb");
  assert.deepEqual(s.privates, [{ id: "s-cccccccccc", name: "Team only" }, { id: "s-dddddddddd", name: "A space" }]);
  assert.equal(parseSameAs("  t-aaaaaaaaaa/s-bbbbbbbbbb ").privates.length, 0);
});

test("anything else is refused", () => {
  for (const bad of ["", "t-aaaaaaaaaa", "s-bbbbbbbbbb/t-aaaaaaaaaa", "t-aaaaaaaaaa/x", "t-AAAAAAAAAA/s-bbbbbbbbbb",
    "t-aaaaaaaaaa/s-bbbbbbbbbb/s-bbbbbbbbbb", "t-aaaaaaaaaa/s-bbbbbbbbbb/../etc", "t-aaaaaaaaa1/s-bbbbbbbbbb"]) {
    assert.throws(() => parseSameAs(bad), bad);
  }
});
