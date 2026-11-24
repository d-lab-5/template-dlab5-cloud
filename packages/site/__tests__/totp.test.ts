import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT, environment, totpIssuer } from "../src/lib/totp.ts";

test("an authenticator tells stage from prod by the host", () => {
  assert.equal(environment("example.org"), "prod");
  assert.equal(environment("stage.example.org"), "stage");
  assert.equal(environment("staging.example.org"), "stage");
  assert.equal(environment("dev.example.org"), "dev");
  assert.equal(environment("main.d0example0000.amplifyapp.com"), "prod");
  assert.equal(environment("stage.d0example0000.amplifyapp.com"), "stage");
  assert.equal(environment("localhost"), "dev");
  assert.equal(environment("127.0.0.1"), "dev");
  assert.equal(environment("shop.example.org"), "prod", "a subdomain that names no environment is prod");
  assert.equal(totpIssuer("stage.example.org"), `${PRODUCT} stage`);
  assert.ok(!totpIssuer("example.org").includes(":"), "a colon would split the otpauth label");
});
