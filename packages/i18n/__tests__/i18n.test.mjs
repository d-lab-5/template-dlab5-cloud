import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (l) => JSON.parse(fs.readFileSync(path.join(here, "..", `${l}.json`), "utf8"));
const en = load("en"), de = load("de"), fr = load("fr");
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

for (const [name, cat] of [["de", de], ["fr", fr]]) {
  test(`${name} has every text English has, and nothing else`, () => {
    assert.deepEqual(Object.keys(cat).sort(), Object.keys(en).sort());
  });
  test(`${name} keeps every placeholder`, () => {
    for (const [k, v] of Object.entries(en)) assert.deepEqual(holes(cat[k]), holes(v), k);
  });
  test(`${name} is translated, not copied`, () => {
    const same = Object.keys(en).filter((k) => en[k] === cat[k] && /[a-z]{4}/.test(en[k]) && !en[k].startsWith("{"));
    // a few words are the same in both languages (Album, Original, OK…): allow a handful
    assert.ok(same.length <= 25, `${same.length} untranslated: ${same.slice(0, 25).join(", ")}`);
  });
}

test("every text the site asks for exists", () => {
  const site = path.join(here, "..", "..", "site", "src");
  const files = fs.readdirSync(site, { recursive: true }).filter((f) => /\.(tsx?|mjs)$/.test(f));
  const used = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(site, f), "utf8").matchAll(/\bt\("([a-z0-9_.]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, [], "add these to en.json, de.json and fr.json");
});
