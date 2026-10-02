# ADR-0005 — Tenants and spaces

Status: **Accepted** · Date: 2026-10-02 · Supersedes ADR-0004's single-group Workspace (`app-<slug>`, created by hand)

## Context

Up to now one Workspace had one Cognito group, created by hand in the console,
and `app-admins` could read everything. That is one tenant with one door. The
products built on this template (the Mediathek's households, DigitalHome's
SmartHomes) all needed the same three things the Workspace lacked:

- **Several tenants**, each with its own admins, created without a console.
- **Inside a tenant**, parts some members may read and others may not.
- **Operators** who run the platform without seeing tenants' content.

Both products arrived at the same shape independently, which is the bar for a
template pattern (blueprinting-dlab5-net `cloud-edge-platform.ttl`).

## Decision

**Tenant.** A tenant (`t-…`, minted) is a family, a home or a team, with its
own admins: the Cognito group **named exactly like the tenant id**.

**Space.** A space (`s-…`, minted) is a part of a tenant with its own readers:
the Cognito group **named exactly like the space id**. Every tenant starts with
one `shared` space; its admins add `private` ones. A space's content is one
object in S3 (`spaces/<id>/data.json`, ADR-0004), and what the tenant knows
about it is an A-Box named like the space (ADR-0007).

**Who sees what** (enforced by AppSync and the Lambdas, not by the page):

| Who | Sees |
|---|---|
| space reader (group `s-…`) | that space: its row, its object, its A-Box |
| tenant admin (group `t-…`) | every space of the tenant; manages members, spaces and edges |
| operator (`app-admins`) | runs the platform: creates tenants, sees tenant names and edge metadata. **No content** unless also a member |

**One writer.** The `tenants` function is the only writer of Tenant and Space
rows *and* of the Cognito groups named like them. The generated create and
update mutations are refused by the models' rules. Members are added by e-mail
(existing accounts only: signup stays admin-only, ADR-0002), and a tenant
keeps at least one admin.

**Two-step sign-in.** TOTP is OPTIONAL in the pool, so members who only read
are not asked. Tenant admins and operators must set it up: the site asks
before anything else, and the Lambdas check it with Cognito (AdminGetUser),
not the token, which says nothing about MFA.

**The same tenant on two sites.** A tenant code (`t-…/s-shared/s-private=Name`)
lets an operator create the tenant on a second site (stage → prod) with the
same ids, so content keyed by those ids is found on both. Each id is checked
for its form and must not exist there yet.

## Consequences

- The `objectProxy` and the storage rules no longer let `app-admins` in by
  being operators. The console-free "escape hatch" of ADR-0004 is gone for
  space content; recovery needs a tenant admin, or a break-glass role whose
  use is visible in CloudTrail.
- Tenant admins see their tenant's private spaces. Private means private from
  other members, not from the admins, who could add themselves anyway.
- A group change reaches a person at their next token refresh (≤ 1 h), or at
  once after "refresh" (constraint 7).
- The Cognito calls need the user pool by wildcard ARN within the account and
  region: naming it closes a CloudFormation cycle. The pool id comes from the
  caller's token issuer at runtime.
- **Trust across sites:** a tenant that exists on two sites can be reached
  through either site's groups. Share a code only between sites run by the
  same operators.
- A product renames the nouns (Household and Vault, SmartHome and Room …) with
  `scripts/rename.mjs --tenant … --space …`; the models, ids and group
  prefixes stay `Tenant`, `Space`, `t-`, `s-`, so product code stays
  comparable with the template's.
