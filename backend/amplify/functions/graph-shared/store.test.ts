// An edge's touch is written at most once an hour.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOUCH_EVERY_MS, touchDue } from "./store";

test("a touch is due the first time, and again only after an hour", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(touchDue(undefined, now), true);
  assert.equal(touchDue("2026-11-20T11:30:00Z", now), false);
  assert.equal(touchDue(new Date(now - TOUCH_EVERY_MS).toISOString(), now), true);
  assert.equal(touchDue("not a date", now), true);
});

test("active means an edge used it in the last 14 days", async () => {
  const { activeAt } = await import("./activity");
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(activeAt("2026-11-07T12:00:00Z", now), true);
  assert.equal(activeAt("2026-11-06T11:00:00Z", now), false);
  assert.equal(activeAt(undefined, now), false);
});
