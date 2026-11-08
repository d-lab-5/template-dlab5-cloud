# The ontology (placeholder)

The vocabulary each space's **A-Box** uses: what a tenant knows (things,
places, people, events, devices …), kept as RDF and synced between the site
and the tenant's edges (ADR-0007).

| File | What |
|---|---|
| `tbox/app.ttl` | classes and properties: a thin layer over schema.org and friends |
| `tbox/app-concepts.ttl` | SKOS concept schemes: new types are data, not code |
| `shapes/app-shapes.ttl` | SHACL: what an A-Box must satisfy; the cloud refuses one that does not |
| `abox/examples/` | fictional examples; real A-Boxes hold personal data and are never committed |

**Replace all of it with your domain.** Keep the shape: English is the master
label and German and French are given; ids live under `https://<domain>/id/`;
the vocabulary under `https://<domain>/ontology#`.

After a change, give the Lambdas the same files:

```bash
node backend/scripts/sync-ontology.mjs     # writes graph-shared/ontology.generated.ts
npm test --workspace packages/ontology
```
