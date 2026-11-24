#!/usr/bin/env node
// Publish this cloud's edge API address at /.well-known/dlab5-edge.json, so
// an edge links with the site's address alone (template-dlab5-edge's
// cloud.discover). The address is no secret: the site's own bundle carries
// it in amplify_outputs.json. Run by amplify.yml after the outputs are copied;
// without outputs (a frontend-only build) it writes nothing and says so.
//
//   node scripts/well-known.mjs [outputs] [site static dir]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputs = process.argv[2] ?? "backend/amplify_outputs.json";
const dir = join(process.argv[3] ?? "packages/site/static", ".well-known");
const api = existsSync(outputs) ? JSON.parse(readFileSync(outputs, "utf8"))?.custom?.app?.edgeApi : undefined;
if (typeof api !== "string" || !api.startsWith("https://")) {
  console.log("well-known: no edge API in the outputs; edges link with the API address instead");
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "dlab5-edge.json"), `${JSON.stringify({ edgeApi: api })}\n`);
console.log(`well-known: ${join(dir, "dlab5-edge.json")} → ${api}`);
