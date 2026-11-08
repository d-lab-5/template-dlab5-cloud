// Same approach as digitalhome-cloud-darkfactory's core tests: n3 for parsing,
// @zazuko/env-node + rdf-validate-shacl for SHACL, as the Lambdas do.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import N3 from "n3";
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const parse = (ttl) => new N3.Parser().parse(ttl);

async function validate(abox) {
  const shapes = rdf.dataset(); shapes.addAll(parse(read("shapes/app-shapes.ttl")));
  const data = rdf.dataset(); data.addAll(parse(abox)); data.addAll(parse(read("tbox/app-concepts.ttl")));
  return new SHACLValidator(shapes, { factory: rdf }).validate(data);
}

const P = "@prefix app: <https://template.dlab5.net/ontology#> . @prefix schema: <https://schema.org/> .\n";

test("the T-Box, the concepts and the shapes parse", () => {
  for (const f of ["tbox/app.ttl", "tbox/app-concepts.ttl", "shapes/app-shapes.ttl"]) assert.ok(parse(read(f)).length > 5, f);
});

test("every concept is labelled in EN, DE and FR", () => {
  const s = new N3.Store(parse(read("tbox/app-concepts.ttl")));
  const SKOS = "http://www.w3.org/2004/02/skos/core#";
  for (const c of s.getSubjects("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", SKOS + "Concept", null)) {
    const langs = s.getObjects(c, SKOS + "prefLabel", null).map((o) => o.language);
    for (const l of ["en", "de", "fr"]) assert.ok(langs.includes(l), `${c.value} has no @${l} prefLabel`);
  }
});

test("the example A-Box conforms", async () => {
  const r = await validate(read("abox/examples/example.ttl"));
  assert.ok(r.conforms, r.results.map((x) => x.message?.[0]?.value).join("; "));
});

test("a thing without a name, or with a type from no scheme, does not", async () => {
  assert.equal((await validate(`${P}<https://template.dlab5.net/id/thing/t-1> a app:Thing .`)).conforms, false);
  assert.equal((await validate(`${P}<https://template.dlab5.net/id/thing/t-1> a app:Thing ; schema:name "x" ; app:thingType app:Nonsense .`)).conforms, false);
});
