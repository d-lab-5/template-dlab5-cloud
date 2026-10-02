# ADR-0004 — Content lives in S3 behind a proxy Lambda; DynamoDB holds the pointer

Status: **Accepted** · Date: 2026-08-28

> **Amended by ADR-0005.** "A workspace" below is now a space. `objectProxy` checks the space's readers group or its tenant's admins group — not `app-admins`, which no longer reads content — and the object is `spaces/<id>/data.json`. The storage rules have no entry for `spaces/*`.

## Context

A workspace's content can be large and is edited as a whole. Two questions had
to be answered together, because the answer to each constrains the other:

**Where does it live?** DynamoDB has a 400 KB item limit and charges by
throughput; modelling a document as rows means a schema migration every time
its shape changes. S3 has neither problem.

**Who may read it?** Access is per-tenant: the members of `app-<slug>`. Amplify
Gen 2's `defineStorage` rules are baked in at *deploy* time, so they cannot
express "the caller is in group `app-<slug>`" for a group that will be created
by hand next month. Declaring the groups in `defineAuth` instead would mean a
backend deploy per tenant — see ADR-0002.

So the static rules cannot be the boundary, and something at runtime has to be.

## Decision

**The object in S3 is the source of truth.** DynamoDB holds a `Workspace`
metadata row: the name, the group, the object key, an advisory version and an
advisory lock. It never holds the content.

**All access goes through the `objectProxy` Lambda.** It reads the caller's
`cognito:groups` from the AppSync identity, fetches the `Workspace` row, and
compares. Only then does it act. The browser never talks to S3 directly, and
`defineStorage`'s coarse rules exist only so the bucket is not world-open.

**Reads hand back a short-lived presigned GET**, so the object never travels
through AppSync — which has neither the payload limits nor the pricing for it.

**Writes go through the function**, not a presigned PUT, because the
correctness mechanism is an S3 `If-Match` precondition and putting it inside
the function means the caller cannot drop, alter or replay it. Unconditional
writes are refused outright.

## Consequences

- **The ETag is the concurrency control; the lock is not.** `lockedBy` /
  `lockedAt` improve the UX of concurrent editing — they let the UI say "Ana is
  editing this" — and enforce nothing. Treating the lock as the mechanism is
  the mistake this note exists to prevent.
- Writes are whole-object. Two people editing different parts of the same
  workspace still conflict, and the loser is told to reload. If that becomes
  painful, the fix is finer-grained objects, not a longer lock.
- `objectProxy` needs `s3:ListBucket` on the bucket, not only object actions.
  Without it S3 answers HeadObject on a missing key with **403**, not 404,
  because it will not reveal whether an object exists to a caller who cannot
  list. A workspace that simply has no object yet then looks identical to a
  permissions failure, and the empty state renders as an error.
- The function is placed in the **data stack** (`resourceGroupName: "data"`).
  It is a custom-mutation handler, so the data stack already references it;
  granting it the table's ARN pointed the reference back and CloudFormation
  refused with "circular dependency found between nested stacks". Co-locating
  removes the edge rather than working around it with wildcard ARNs, which
  would also have left the table *name* unresolvable at runtime.
- Errors are deliberately indistinguishable: "no such workspace" and "not
  yours" return the same message, or any signed-in user could enumerate ids.
- Two mutations share one handler, so it discriminates on the **arguments**
  (`body` is present on exactly one) rather than on `event.info.fieldName`.
  Relying on the field name has failed silently before: the write took the read
  branch, returned `{exists:false}` and stored nothing, with no error anywhere.
