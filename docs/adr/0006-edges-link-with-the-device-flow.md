# ADR-0006 — Edges link with the device flow, and belong to a tenant

Status: **Accepted** · Date: 2026-10-02

## Context

An **edge** is a computer a tenant runs: a person's PC with a local app, a home
server with Node-RED, a robot with ROS 2. It produces what the site shows and
keeps what must stay private. It needs to talk to a cloud it has no account in.
Handing it AWS credentials means account keys on every edge and no revocation
short of rotating them.

digitalhome.cloud solved this for `digitalhome-edge` boxes (DH-SPEC-100): an
RFC 8628 device authorization grant. The Mediathek reused it unchanged. Two
instances: a template pattern.

## Decision

**The device flow, on the shared wire** (`docs/specs/edge-cloud-api.md`):

- `POST /edge/v1/device_authorization` → a code (`XXXX-XXXX`) and a link to
  this site's `/link`.
- A **tenant admin** signs in, opens the link, checks the host name and
  approves it for one of their tenants. Operators may list and revoke edges,
  never link one into a tenant.
- The edge's next `POST /edge/v1/token` returns a device token
  (`dt_v1_<edge_id>.<secret>`), bound to that tenant. The cloud stores only
  `sha256(token)`; `/token/rotate` renews it before it expires.
- Every other edge route takes the token as a Bearer and reaches **only its
  tenant's spaces**.
- **A version gate.** Every call names the edge's version
  (`X-Edge-Version`). Below `MIN_EDGE_VERSION` every route answers **426
  `edge_too_old`**, pairing included, so an edge without a fix cannot keep
  working.
- **410 is a revoke.** A revoked edge gets 410 and must pair again. A product
  route that wants to say "this item is gone" uses 410 **with its own error
  code**, never a bare 410, or edges unlink themselves.
- The template's routes: pairing, `/telemetry`, `/graphs/{list,get,put}`
  (ADR-0007) and `/models` (files an edge fetches on its first start). A
  product adds its own (the Mediathek's media uploads) behind the same gate.
- **Releases.** `backend/edge-release/` (filled by the edge repository's
  publish script) is deployed to a private bucket; Settings → Edges hands
  tenant admins 15-minute links to the installer and package with their
  SHA-256. The About page shows the minimum and the offered edge version.

## Consequences

- An edge holds no AWS credentials, only a token that can be revoked on its
  own (Settings → Edges).
- The pairing tables live in the **data** stack, because the approval
  resolver (data) reads them and edge functions (edge stack) read data's
  tables: data never points at edge.
- Raising `MIN_EDGE_VERSION` locks out every older edge at once. Release the
  new edge first, then raise it.
- Changes to the shared wire go into the spec first, before either side
  diverges.
