# ADR-0007 — Knowledge as an RDF graph per space, synced with the edges

Status: **Accepted** · Date: 2026-10-02

## Context

What a tenant *knows* — people, places, rooms, devices, events, and how they
relate — does not fit a column per idea: every new kind of thing would be a
schema change. DigitalHome.Cloud models homes as a T-Box, SHACL shapes and
per-tenant A-Boxes; the Mediathek does the same for a family's people and
events. Both edit the knowledge on the edge and in the browser.

## Decision

- **A vocabulary over standards.** `packages/ontology` holds the T-Box (a thin
  layer over schema.org and friends), SKOS concept schemes (new types are
  data) and SHACL shapes. English is the master label; German and French are
  given. The template ships a placeholder: replace it with your domain.
- **One A-Box per space**, named like the space, in the Graph table: Turtle,
  with a version. Readers of the space and its tenant's admins read it.
- **Validated on every write**, browser or edge, against the same shapes the
  ontology's tests use (the Lambdas carry a generated copy,
  `node backend/scripts/sync-ontology.mjs`). An A-Box may only describe
  things under `https://<domain>/id/`; it cannot change the vocabulary.
- **Optimistic versions, three-way merge.** A write names the version it read.
  If someone saved since, the answer is a conflict with the current document
  (409 for an edge); the writer merges statement by statement against the
  version it last synced and writes again. Nothing is overwritten silently.
- Browser: `saveGraph` (the tenant's admins, with two-step sign-in). Edge:
  `/edge/v1/graphs/{list,get,put}` with its device token, limited to its
  tenant.

## Consequences

- A-Boxes are personal data. They live in AWS behind the space's groups;
  whatever the edge keeps private (biometrics, raw sensor data) never enters
  them.
- A new concept appears in the site and on the edges in three languages at
  once, without a deploy of either.
- An item is limited to 400 KB: a large knowledge base is split into several
  graphs.
- Real A-Boxes never go into the repository, only fictional examples.
