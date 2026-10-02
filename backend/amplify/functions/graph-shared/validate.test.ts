// npm test (backend): the Lambdas validate against the same files as
// packages/ontology, and refuse what its shapes refuse (ADR-0007).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONCEPTS, SHAPES, TBOX } from "./ontology.generated";
import { validateAbox } from "./validate";

const ONTOLOGY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/ontology");
const read = (rel: string) => fs.readFileSync(path.join(ONTOLOGY, rel), "utf8");
const P = `@prefix app: <https://template.dlab5.net/ontology#> . @prefix schema: <https://schema.org/> .\n`;

test("the generated copy matches packages/ontology", () => {
  assert.equal(TBOX, read("tbox/app.ttl"), "run: node backend/scripts/sync-ontology.mjs");
  assert.equal(CONCEPTS, read("tbox/app-concepts.ttl"), "run: node backend/scripts/sync-ontology.mjs");
  assert.equal(SHAPES, read("shapes/app-shapes.ttl"), "run: node backend/scripts/sync-ontology.mjs");
});

test("a conforming A-Box is accepted", async () => {
  const v = await validateAbox(`${P}<https://template.dlab5.net/id/thing/t-1> a app:Thing ; schema:name "Printer" ; app:thingType app:Device .`);
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.equal(v.triples, 3);
});

test("a thing without a name is refused, with the shape's message", async () => {
  const v = await validateAbox(`${P}<https://template.dlab5.net/id/thing/t-1> a app:Thing .`);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /needs a name/.test(p)), v.problems.join("; "));
});

test("an A-Box may not describe the vocabulary or anything outside the id space", async () => {
  const v = await validateAbox(`${P}app:Thing a <http://www.w3.org/2002/07/owl#Class> .`);
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /outside/);
});

test("not Turtle is refused, not thrown", async () => {
  const v = await validateAbox("this is not turtle");
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /not valid Turtle/);
});
