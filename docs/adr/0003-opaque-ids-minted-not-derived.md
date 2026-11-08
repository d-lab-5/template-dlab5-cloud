# ADR-0003 — Ids are minted, never derived from names

Status: **Accepted** · Date: 2026-08-28

> **Amended by ADR-0005.** The Workspace became Tenant and Space. The rule stands unchanged; the ids are now `t-…` and `s-…` (`mintTenantId()`, `mintSpaceId()`), the groups are named exactly like them, and a space's object lives under `spaces/<id>/`.

## Context

A workspace needs an identifier. The tempting choice is to slugify its name:
"Fleet Operations" → `fleet-operations`. It is readable in a URL, it needs no
generator, and it makes the id self-describing.

It is also a trap, because the identifier is not just an identifier. It is:

- the **DynamoDB partition key** of the `Workspace` row,
- the **Cognito group** name, `app-<slug>`, that grants access,
- the **S3 prefix**, `workspaces/<slug>/`, that the object lives under.

Names change. A rename is then a migration across all three — and DynamoDB
cannot update a primary key at all, so there is no in-place path. The rename
becomes: create a new row, create a new group, move every member, copy every
object, delete the old. For a word.

## Decision

A workspace's id is **minted**: `w-` plus ten characters from
`mintWorkspaceId()` in `@dlab5/app-core`. It is opaque and permanent. The name
is an ordinary mutable field.

Randomness comes from `crypto.getRandomValues`, not `Math.random` — not because
an id is secret (it is in every URL) but because `Math.random` is seeded per
process and two Lambdas cold-starting in the same millisecond have collided in
the wild.

The alphabet excludes `0`, `1`, `l`, `o` and `i`, because someone has to read
an id off a screen and type it into the Cognito console.

**Never render an id where a name belongs.** A workspace page is titled with
its name. The id appears in exactly one place in this template — the
confirmation after creating a workspace — because that is the moment someone
must copy it to create the group.

## Consequences

- URLs are opaque: `/w/w-4k9mqhtx2p/` tells a reader nothing. Accepted. The
  page title, the rail and the switcher all say the name.
- Re-identifying a workspace is impossible in place. If a fork needs it, it is
  an export and a reload under a fresh id, not an update.
- `groupForWorkspace()` and `objectKeyForWorkspace()` in `packages/core` are
  the only places the derivation is written. The backend must agree with them;
  deriving inline "just this once" is how the two sides drift.
- A test asserts the alphabet exclusions, because they are the kind of detail
  that gets "tidied up" into a plain base32 alphabet by someone who does not
  know a human has to transcribe the output.
