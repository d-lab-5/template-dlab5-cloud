# Security

## Reporting

Report a suspected vulnerability privately — open a GitHub security advisory on
the repository, or contact the maintainer directly. Please do not open a public
issue for anything exploitable.

## Treat this repository as public

Whether or not the fork is public today, assume it will be. Enable GitHub
secret scanning and push protection as a backstop; the backstop is not the
plan.

**Never commit:**

- `amplify_outputs.json` — it names the user pool, identity pool and AppSync
  endpoint. It is generated at deploy time and is ignored by `.gitignore`.
- AWS account IDs and ARNs, in code, docs or ADRs.
- Cognito user-pool, identity-pool or AppSync IDs.
- `.env` files. `.env.example` is the one committed file, and it carries no
  values.
- Private keys, certificates, `credentials`, `aws-exports.js`.
- Real names, email addresses or internal hostnames in seed data or fixtures.
- `.dev-sandbox.log` — `scripts/dev.sh` writes the sandbox's own output there,
  which names CloudFormation stacks and can carry the account id. It is
  ignored, and it is worth knowing it exists before you paste it into an issue.

## `GATSBY_` variables are public

Any environment variable prefixed `GATSBY_` is **inlined into the JavaScript
bundle at build time** and is readable by anyone who loads the site. Never put
a secret behind that prefix. Configuration that must stay private belongs in a
Lambda's environment, not in the frontend.

## Where the security boundary actually is

Three places, and only three:

1. **The Cognito user pool.** `allowAdminCreateUserOnly` and
   `allowUnauthenticatedIdentities: false` are set in `backend.ts`, at the pool
   level, so they hold against a direct API call and not merely against the UI.
2. **AppSync's model authorization rules** in `data/resource.ts`. `allow.group`
   and `allow.groupDefinedIn` are enforced server-side.
3. **`objectProxy`.** It compares the caller's `cognito:groups` against the
   space's group, or its tenant's admins group, before touching S3. Operators
   are not let in by being operators (ADR-0005).

Everything in `packages/site` is ergonomics. A check in a React component
improves the experience of a legitimate user and stops nobody. In particular:

- `defineStorage`'s access rules are coarse and are **not** the boundary for
  space content — there is no rule for `spaces/*` at all. ADR-0004.
- `allow.authenticated()` on the custom mutations means "signed in is enough to
  call this". It is not the access check; the Lambda is.

## Habits worth keeping

- Grant the narrowest IAM action that does the job, and say in a comment what
  the function must therefore be unable to do. `objectProxy` can read the
  `Space` and `Tenant` rows and cannot write them — deliberately, so it cannot
  rewrite the metadata it authorises against.
- Return the same error for "does not exist" and "not yours". Distinguishing
  them lets any signed-in user enumerate ids.
- Log the detail, return a generic message. An S3 or DynamoDB error string can
  name a bucket or a table.
- Validate at the boundary, and report every problem at once rather than the
  first — a validator that reports one field per attempt turns a malformed
  payload into a sequence of deploys.

## The demo account

`scripts/demo.py` creates `demo-user@example.com` with a password committed in
plain text, and puts it in `app-admins`. That is deliberate and it is safe only
because of what a sandbox is: your own private deployment, in your own account,
that nobody else can reach. It is not a shared secret, and there is nothing to
leak — anyone reading the repository can see the password and still has no pool
to use it against.

It stops being safe the moment either of those stops being true:

- **Never run `demo.py` against a deployed branch.** It reads whatever
  `backend/amplify_outputs.json` points at, and it would happily create an
  admin with a published password in `stage`. It is written for sandboxes and
  has no way to tell the difference.
- **Never carry the demo account into a real environment.** Delete the sandbox
  when you are done (`option 2`, or
  `npm --prefix backend run sandbox:delete`), which removes the pool and the
  account with it.

Override with `DEMO_EMAIL` / `DEMO_PASSWORD` if even that is more than you want
on disk. A fork that keeps the script should keep this section with it.

## AWS credentials

Nothing in this repository holds AWS credentials, and nothing should.
`ampx sandbox` resolves them from the ordinary SDK chain — environment
variables, then `AWS_PROFILE` or `--profile`, then `~/.aws`, then SSO or an
instance role — so a sandbox deploys to **whatever account your shell already
points at**.

That is the risk worth naming: there is no repository-level guard against
deploying a sandbox into a production account, because the repository does not
get a say. `npm run dev` prints the account, region and profile before it
creates anything, and reading that line is the control. Prefer short-lived
credentials (SSO, `aws sso login`) over the long-lived `AKIA…` keys in
`~/.aws/credentials` wherever the organisation supports it.

A sandbox is a real deployment. `npm --prefix backend run sandbox:delete` when
you are done with it, rather than leaving an unattended Cognito pool and S3
bucket in an account nobody is watching.

## Dependencies

`npm audit` on a fresh install of this template reports findings in Gatsby's
transitive tree. Review before shipping; do not run `npm audit fix --force`,
which will happily downgrade Gatsby and break the graphql 16 resolution that
ADR-0001 depends on.
