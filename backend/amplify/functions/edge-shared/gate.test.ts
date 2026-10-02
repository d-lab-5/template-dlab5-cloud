// npm test (backend): tsx --test
import assert from "node:assert/strict";
import { test } from "node:test";
import { atLeast, MIN_EDGE_VERSION, versionGate } from "./http";
import { checkToken, type EdgeRow } from "./registry";

test("only edges from the minimum version on may talk to this site", () => {
  // the gate compares against MIN_EDGE_VERSION, whatever a product raises it to
  for (const ok of ["1.0.0", "1.0.1", "1.2.0", "2.0.0", "1.0.0rc"]) assert.ok(atLeast(ok, "1.0.0"), ok);
  for (const old of ["0.1.0", "0.9.9", "", undefined, "v1", "one"]) assert.ok(!atLeast(old as string, "1.0.0"), String(old));
  assert.ok(atLeast(MIN_EDGE_VERSION));
  const ev = (v?: string) => ({ headers: v ? { "x-edge-version": v } : {} }) as never;
  assert.equal(versionGate(ev(MIN_EDGE_VERSION)), null);
  const r = versionGate(ev("0.0.1")) as { statusCode: number; body: string };
  assert.equal(r.statusCode, 426);
  assert.equal(JSON.parse(r.body).error, "edge_too_old");
  assert.equal((versionGate(ev()) as { statusCode: number }).statusCode, 426);   // no version: too old
});

const row = (over: Partial<EdgeRow> = {}): EdgeRow => ({
  edge_id: "e-1", device_token_hash: "h-now", status: "linked",
  device_token_expires: "2027-10-01T00:00:00Z", ...over,
}) as EdgeRow;

test("a device token works until it expires, and not after", () => {
  const before = Date.parse("2027-09-30T00:00:00Z"), after = Date.parse("2027-10-02T00:00:00Z");
  assert.equal(checkToken(row(), "h-now", before).ok, true);
  assert.deepEqual(checkToken(row(), "h-now", after), { ok: false, reason: "unauthorized" });
  assert.deepEqual(checkToken(row(), "other", before), { ok: false, reason: "unauthorized" });
  assert.deepEqual(checkToken(row({ status: "revoked" }), "h-now", before), { ok: false, reason: "revoked" });
  assert.equal(checkToken(row({ device_token_expires: undefined }), "h-now", after).ok, true);   // older rows
});
