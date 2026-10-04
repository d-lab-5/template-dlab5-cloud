#!/usr/bin/env node
/**
 * Proves the tenant and edge path against a real deployment (a sandbox, or
 * a branch's outputs), the way verify-auth.mjs proves the sign-in:
 *
 *   1. an operator signs in, with two-step sign-in (TOTP set up on first run)
 *   2. creates a tenant naming itself as its first admin (ADR-0005)
 *   3. an edge asks for a pairing code; the admin approves it; the edge
 *      receives its device token (ADR-0006)
 *   4. the edge reads its tenant and spaces (/edge/v1/tenant)
 *   5. A-Box sync: a write, a stale write (409), an invalid one (422) (ADR-0007)
 *   6. an edge without a version is refused (426)
 *   7. the space's object round-trips through objectProxy (ADR-0004)
 *   8. the admin revokes the edge; its next call gets 410
 *
 *   APP_USER=… APP_PASSWORD=… APP_TOTP_FILE=… node scripts/verify-edge.mjs [--new-password '…']
 *
 * APP_USER must be in app-admins. APP_TOTP_FILE keeps the TOTP secret this
 * script sets up on the account's first run (0600), so later runs can sign
 * in; never commit it. Each run creates one tenant ("verify-edge …"): use a
 * sandbox, not production.
 */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import {
  confirmSignIn, fetchAuthSession, fetchMFAPreference, setUpTOTP, signIn,
  updateMFAPreference, verifyTOTPSetup,
} from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = JSON.parse(readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8"));
Amplify.configure(outputs);
const mem = new Map();
cognitoUserPoolsTokenProvider.setKeyValueStorage({
  setItem: async (k, v) => void mem.set(k, v),
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  removeItem: async (k) => void mem.delete(k),
  clear: async () => void mem.clear(),
});

const { APP_USER: username, APP_PASSWORD: password, APP_TOTP_FILE: totpFile } = process.env;
const newPasswordIdx = process.argv.indexOf("--new-password");
const newPassword = newPasswordIdx > -1 ? process.argv[newPasswordIdx + 1] : undefined;
if (!username || !password || !totpFile) {
  console.error("\n  set APP_USER, APP_PASSWORD and APP_TOTP_FILE\n");
  process.exit(2);
}
const EDGE = `${outputs.custom?.app?.edgeApi}/edge/v1`;
const MIN = outputs.custom?.app?.minEdgeVersion ?? "0.1.0";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/* -- TOTP (RFC 6238), so the script can pass the two-step sign-in ---------- */

function base32(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/* -- the edge's side: plain HTTP, as an edge speaks it --------------------- */

async function edge(path, body = {}, { token, version = MIN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (version) headers["X-Edge-Version"] = version;
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${EDGE}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const client = generateClient();
async function gql(query, variables) {
  try {
    const r = await client.graphql({ query, variables });
    return r.data;
  } catch (err) {
    throw new Error((err?.errors ?? [err]).map((e) => e.message).join("; "));
  }
}

try {
  console.log("tenant and edge path (ADR-0005, ADR-0006, ADR-0007)\n");

  /* 1. sign in, two-step ------------------------------------------------- */
  let res = await signIn({ username, password });
  if (res.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
    if (!newPassword) throw new Error("the account needs --new-password");
    res = await confirmSignIn({ challengeResponse: newPassword });
  }
  if (res.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") {
    res = await confirmSignIn({ challengeResponse: totp(readFileSync(totpFile, "utf8").trim()) });
  }
  if (res.nextStep?.signInStep === "CONTINUE_SIGN_IN_WITH_TOTP_SETUP") {
    const secret = res.nextStep.totpSetupDetails.sharedSecret;
    writeFileSync(totpFile, secret, { mode: 0o600 });
    res = await confirmSignIn({ challengeResponse: totp(secret) });
  }
  check(res.isSignedIn, "operator signed in");
  const mfa = await fetchMFAPreference();
  if (!(mfa.enabled ?? []).includes("TOTP")) {
    const setup = await setUpTOTP();
    writeFileSync(totpFile, setup.sharedSecret, { mode: 0o600 });
    await verifyTOTPSetup({ code: totp(setup.sharedSecret) });
    await updateMFAPreference({ totp: "PREFERRED" });
  }
  check(((await fetchMFAPreference()).enabled ?? []).includes("TOTP"), "two-step sign-in is on");

  /* 2. a tenant ------------------------------------------------------------ */
  const name = `verify-edge ${new Date().toISOString().slice(0, 16)}`;
  const made = (await gql(`mutation T($n: String!, $a: String!) { addTenant(name: $n, adminEmail: $a) { id name } }`,
    { n: name, a: username })).addTenant;
  check(/^t-[a-z0-9]{10}$/.test(made.id), "a tenant is created with a minted id", made.id);
  await fetchAuthSession({ forceRefresh: true });                     // constraint 7
  const groups = (await fetchAuthSession()).tokens?.idToken?.payload?.["cognito:groups"] ?? [];
  check(groups.includes(made.id), "its creator is its admin after a token refresh");
  const spaces = (await gql(`query S($t: ID!) { spacesByTenant(tenantId: $t) { items { id name kind } } }`,
    { t: made.id })).spacesByTenant.items;
  const shared = spaces.find((s) => s.kind === "shared");
  check(!!shared, "it has its shared space", shared?.id);

  /* 3. pairing ------------------------------------------------------------- */
  const da = await edge("device_authorization", { client_id: "verify-edge", scope: "edge.link",
    device_info: { machine_id: "verify-edge", hostname: "verify-edge", dhe_version: `verify-edge ${MIN}` } });
  check(da.status === 200 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(da.body.user_code ?? ""), "an edge gets a pairing code", da.body.user_code);
  const pending = await edge("token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: da.body.device_code, client_id: "verify-edge" });
  check(pending.body.error === "authorization_pending", "before approval the edge waits", pending.body.error);
  const ok = (await gql(`mutation A($c: String!, $t: String!) { approveDeviceCode(user_code: $c, tenant_id: $t) { status } }`,
    { c: da.body.user_code, t: made.id })).approveDeviceCode;
  check(ok.status === "approved", "the tenant's admin approves it");
  // poll as an edge does: every `interval` seconds, slower on slow_down (RFC 8628)
  let tok, wait = (da.body.interval ?? 5) * 1000;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, wait));
    tok = await edge("token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: da.body.device_code, client_id: "verify-edge" });
    if (tok.body.error === "slow_down") { wait += 5000; continue; }
    if (tok.body.error !== "authorization_pending") break;
  }
  const token = tok.body.access_token;
  check(tok.status === 200 && /^dt_v1_/.test(token ?? ""), "the edge receives its device token");

  /* 4. its tenant ------------------------------------------------------------ */
  const t = await edge("tenant", {}, { token });
  check(t.status === 200 && t.body.tenant?.id === made.id && t.body.spaces?.some((s) => s.id === shared.id),
    "the edge learns its tenant and spaces");

  /* 5. A-Box sync ------------------------------------------------------------ */
  const P = "@prefix app: <https://template.dlab5.net/ontology#> . @prefix schema: <https://schema.org/> .\n";
  const ttl = `${P}<https://template.dlab5.net/id/thing/t-verify> a app:Thing ; schema:name "Verified" .`;
  const put1 = await edge("graphs/put", { name: shared.id, ttl, baseVersion: 0 }, { token });
  check(put1.status === 200 && put1.body.version === 1, "an A-Box is written", `version ${put1.body.version}`);
  const stale = await edge("graphs/put", { name: shared.id, ttl, baseVersion: 0 }, { token });
  check(stale.status === 409 && stale.body.current?.version === 1, "a stale write is a conflict with the current version");
  const bad = await edge("graphs/put", { name: shared.id, ttl: `${P}<https://template.dlab5.net/id/thing/t-x> a app:Thing .`, baseVersion: 1 }, { token });
  check(bad.status === 422 && bad.body.problems?.length > 0, "an A-Box the shapes refuse is not stored", bad.body.problems?.[0]);
  const got = await edge("graphs/get", { name: shared.id }, { token });
  check(got.body.version === 1 && /Verified/.test(got.body.ttl ?? ""), "and reads back as written");

  /* 6. the version gate ---------------------------------------------------- */
  const old = await edge("tenant", {}, { token, version: null });
  check(old.status === 426 && old.body.error === "edge_too_old", "an edge that names no version is refused (426)");

  /* 7. the space's object ---------------------------------------------------- */
  const w = (await gql(`mutation W($s: String!, $b: String!) { writeObject(spaceId: $s, body: $b, expectAbsent: true) { etag exists } }`,
    { s: shared.id, b: JSON.stringify({ verified: true }) })).writeObject;
  const r = (await gql(`mutation R($s: String!) { readObject(spaceId: $s) { url etag exists } }`, { s: shared.id })).readObject;
  const back = r.url ? await (await fetch(r.url)).json() : null;
  check(w.etag && r.exists && back?.verified === true, "the space's object round-trips through objectProxy");

  /* 8. revoke ---------------------------------------------------------------- */
  const edgeId = tok.body.edge_id;
  await gql(`mutation V($e: String!) { revokeEdge(edge_id: $e, reason: "verify-edge") { edge_id status } }`, { e: edgeId });
  const after = await edge("telemetry", { protocol_version: 1, kind: "delta" }, { token });
  check(after.status === 410, "a revoked edge gets 410", String(after.status));
} catch (err) {
  console.error(`\n  ${err?.name ?? "error"}: ${err?.message ?? err}`);
  failures++;
}

console.log(failures ? `\n  ${failures} failed\n` : "\n  all passed\n");
process.exit(failures ? 1 : 0);
