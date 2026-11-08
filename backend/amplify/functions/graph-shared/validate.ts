// Server-side A-Box validation: the SAME shapes and the same validator
// (rdf-validate-shacl) as packages/ontology's tests, so an A-Box that is
// invalid there cannot be saved here, whether it comes from the browser or
// from an edge. ADR-0007.

import N3 from "n3";
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { CONCEPTS, SHAPES } from "./ontology.generated";

/** DynamoDB holds an item up to 400 KB; keep a margin for the other fields. */
export const MAX_TTL_BYTES = 350_000;
export const GRAPH_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** A-Boxes describe things, they do not change the vocabulary. */
const ID_SPACE = "https://template.dlab5.net/id/";

const parse = (ttl: string) => new N3.Parser().parse(ttl);

let shapes: ReturnType<typeof rdf.dataset> | undefined;
let concepts: N3.Quad[] | undefined;

export interface Verdict {
  ok: boolean;
  problems: string[];
  triples: number;
}

export async function validateAbox(ttl: string): Promise<Verdict> {
  if (Buffer.byteLength(ttl, "utf8") > MAX_TTL_BYTES) {
    return { ok: false, problems: [`the A-Box is larger than ${MAX_TTL_BYTES} bytes; split it into several graphs`], triples: 0 };
  }
  let quads: N3.Quad[];
  try {
    quads = parse(ttl);
  } catch (err) {
    return { ok: false, problems: [`not valid Turtle: ${(err as Error).message}`], triples: 0 };
  }
  const outside = quads.find((q) => q.subject.termType === "NamedNode" && !q.subject.value.startsWith(ID_SPACE));
  if (outside) {
    return {
      ok: false,
      problems: [`an A-Box may only describe ${ID_SPACE}… things; ${outside.subject.value} is outside (the vocabulary lives in packages/ontology)`],
      triples: quads.length,
    };
  }
  shapes ??= (() => { const d = rdf.dataset(); d.addAll(parse(SHAPES)); return d; })();
  concepts ??= parse(CONCEPTS);
  const data = rdf.dataset();
  data.addAll(quads);
  data.addAll(concepts);
  // The libraries' typings disagree about the environment type; at runtime
  // this is exactly what packages/ontology's tests do.
  const report = await new SHACLValidator(shapes, { factory: rdf as any }).validate(data);
  const problems = [...new Set(report.results.map((r: any) => r.message?.[0]?.value ?? "invalid"))] as string[];
  return { ok: report.conforms, problems, triples: quads.length };
}
