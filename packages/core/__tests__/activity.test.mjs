import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, isActive, split } from "../dist/index.js";

const now = Date.parse("2026-11-20T12:00:00Z");

test("active means an edge used it in the last 14 days", () => {
  assert.equal(isActive({ edgeSeenAt: "2026-11-19T12:00:00Z" }, now), true);
  assert.equal(isActive({ edgeSeenAt: "2026-11-06T12:00:01Z" }, now), true);
  assert.equal(isActive({ edgeSeenAt: "2026-11-06T11:59:59Z" }, now), false);
  assert.equal(isActive({ edgeSeenAt: null }, now), false);
  assert.equal(isActive(undefined, now), false);
});

test("the split orders active by edge use and passive by change", () => {
  const items = [{ id: "s-a" }, { id: "s-b" }, { id: "s-c" }, { id: "s-d" }];
  const got = split(items, {
    "s-a": { name: "s-a", edgeSeenAt: "2026-11-18T00:00:00Z" },
    "s-b": { name: "s-b", edgeSeenAt: "2026-11-20T10:00:00Z" },
    "s-c": { name: "s-c", updatedAt: "2026-10-01T00:00:00Z" },
    "s-d": { name: "s-d", edgeSeenAt: "2026-09-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" },
  }, now);
  assert.deepEqual(got.active.map((s) => s.id), ["s-b", "s-a"]);
  assert.deepEqual(got.passive.map((s) => s.id), ["s-d", "s-c"]);
});

test("ago says minutes, hours, then days", () => {
  assert.deepEqual(ago("2026-11-20T11:59:50Z", now), { key: "ago.now", n: 0 });
  assert.deepEqual(ago("2026-11-20T11:15:00Z", now), { key: "ago.min", n: 45 });
  assert.deepEqual(ago("2026-11-20T09:00:00Z", now), { key: "ago.h", n: 3 });
  assert.deepEqual(ago("2026-11-15T12:00:00Z", now), { key: "ago.d", n: 5 });
  assert.equal(ago(null, now), null);
});
