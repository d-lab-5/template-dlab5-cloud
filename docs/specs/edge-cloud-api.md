# Edge ↔ cloud API (template profile)

**Status:** v1 · **Date:** 2026-10-02 · **Base:** DigitalHome's
`digitalhome-edge/docs/specs/edge-cloud-api.md` v0.2 (DH-SPEC-100)

This is the wire an edge made from `template-dlab5-edge` speaks to a site made
from this template. It **is** DH-SPEC-100's device flow; this file records
only what the template adds or generalizes, so the two never drift apart in
silence. A change to the shared part goes into DH-SPEC-100 first.

All routes are `POST`, JSON in and out, under `<edge API>/edge/v1`. The edge
API address is in `amplify_outputs.json` (`custom.app.edgeApi`) and on the
About page.

## 1. What every call carries

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Edge-Version` | the edge's version, e.g. `1.2.0` |
| `Authorization` | `Bearer dt_v1_<edge_id>.<secret>` — every route but the two pairing ones |

**Version gate.** Below the site's `MIN_EDGE_VERSION`, or without the
header, **every** route answers:

```http
426  {"error": "edge_too_old", "min_version": "1.0.0", "message": "…"}
```

## 2. Pairing (DH-SPEC-100 §3, unchanged on the wire)

| Route | Answer |
|---|---|
| `device_authorization` `{client_id, scope, device_info}` | `{device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}` |
| `token` `{grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code, client_id}` | 200 `{access_token, token_type, expires_in, edge_id, scope, cloud_endpoints}`, or 400 `{error: authorization_pending \| slow_down \| access_denied \| expired_token}` |
| `token/rotate` | a new token; the old one stops working |
| `telemetry` | 200; 401 unknown token; **410 revoked** |

**Generalized:** DH-SPEC-100 binds an edge to a SmartHome (`home_id`). Here a
**tenant admin** approves the code for one of their tenants (`/link`), and the
token is bound to that **tenant**: every route below reaches only its spaces.
An operator cannot link an edge into a tenant.

## 3. Routes the template adds

| Route | Body | Answer |
|---|---|---|
| `tenant` | `{}` | `{tenant: {id, name}, spaces: [{id, name, kind}]}` — the tenant the edge was linked to; an edge matches spaces by **name**, because ids differ between sites |
| `graphs/list` | `{}` | `{graphs: [{name, version, triples, updatedAt, updatedBy}]}` — one per space of the tenant |
| `graphs/get` | `{name}` (a space id) | `{name, version, ttl}`; version 0 and empty Turtle when there is none yet |
| `graphs/put` | `{name, ttl, baseVersion}` | 200 `{status: "ok", name, version, triples}`; **409** `{error: "version_conflict", current: {name, version, ttl, …}}` when someone saved since `baseVersion` (merge and put again); **422** `{error: "invalid", problems}` when the shapes refuse it; 404 `not_found` for a space outside the tenant |
| `models` | `{set}` | `{set, files: [{name, sha256, size, url}]}` — 15-minute links; 404 `no_models` when the site offers none |

`403 {error: "no_tenant"}`: an edge linked before it had a tenant; link it again.

## 4. Status codes an edge must tell apart

| Code | Meaning | Edge does |
|---|---|---|
| 401 | token unknown | re-pair |
| **410 `revoked`** (or no error code) | the link was revoked | forget the token, re-pair |
| 410 **with a product error code** | *this item* is gone (e.g. permanently deleted) | mark the item, keep the link |
| 426 `edge_too_old` | update the edge | stop, tell the person |
| 409 | stale write | merge, retry |
| 422 | the shapes refused the A-Box | show the problems |

A product route that answers 410 for an item **must** set its own `error`
code. A bare 410 unlinks the edge (ADR-0006).

## 5. Products add routes

A product adds its own routes behind the same gate (the Mediathek's
`media/uploads`, `media/items` …): `versionGate`, then `verifyDeviceToken`,
then the tenant from the token row — never from the body.
