---
name: dlab5-cloud-template
description: Working in a repository built from the D-LAB-5 cloud template (template-dlab5-cloud), the CLOUD half of a cloud-and-edge product: an npm-workspace monorepo with a deliberately NON-workspace Amplify Gen 2 backend, a Gatsby 5 site behind one root-mounted Cognito gate, tenants with spaces (t-…/s-… groups, one `tenants` function as their only writer), an edge API with the RFC 8628 device flow, an RDF A-Box per space with SHACL. Use in template-dlab5-cloud or any product made from it (e.g. the Mediathek), or when a repo shows the tells: a `backend/` with its own lockfile beside `packages/site`, an AuthGate in both gatsby-browser and gatsby-ssr, functions/tenants and functions/edge-shared, packages/ontology. Carries what bites: graphql 15 vs 16, the SSR-mounted gate, builds without amplify_outputs.json, the untyped AppSync client, the cached-stylesheet trap, the user-pool cycle, the fork rename. Edge half: dlab5-edge-template.
---

<!--
  This is the content of the template's CLAUDE.md, kept as a skill so it
  travels with the person rather than with the repository. The repo ignores
  CLAUDE.md; edit THIS file and the guidance follows you into every fork.
-->

# The D-LAB-5 cloud template

Guidance for Claude Code working in this repository.

## Have you just forked this?

**Run the rename first, before writing any code:**

```bash
node scripts/rename.mjs --name "Fleet" --slug fleet --prefix fl \
  --domain fleet.dlab5.net --repo d-lab-5/fleet-dlab5-cloud \
  --tenant Household --space Vault --dry-run
```

Drop `--dry-run` when the diff looks right, then reinstall — the workspace
package names changed, so the symlinks in `node_modules` no longer resolve:

```bash
rm -rf node_modules packages/*/node_modules package-lock.json
npm install && npm --prefix backend install && npm test && npm run build
```

What is placeholder, and expected to go:

| Placeholder | Replace with |
|---|---|
| `packages/site/src/pages/w.tsx` — five stub views | your actual screens |
| `Shell.tsx` → `railItems()` / `toolItems()` | your menu |
| `GuestLanding.tsx` → hero copy and `<Art/>` | what your app is |
| `packages/ontology/` — a placeholder T-Box, concepts and shapes | your domain's vocabulary (then `node backend/scripts/sync-ontology.mjs`) |
| `--tenant` / `--space` nouns (rename.mjs rewrites the English texts) | German and French in `packages/i18n` by hand |
| a space's object (`loadObject`/`saveObject`) as the only content | your models, beside `Tenant`/`Space` |
| this section of `CLAUDE.md`, and `README.md` | your project |

What is **not** placeholder, and should survive: `AuthGate` (with its
two-step sign-in), `amplify.ts`, `useTheme`, `gatsby-ssr.tsx`,
`gatsby-node.ts`, `amplify.yml`, `customHttp.yml`, `objectProxy`, the
`tenants` and edge functions (`edge-shared/`, `edgeDeviceAuthz`, `edgeToken`,
`edgeTokenRotate`, `edgeTelemetry`, `edgeDeviceApproval`, `edgeGraphs`,
`edgeModels`, `edgeRelease`), `graphs`, the hardening in `backend.ts`,
`docs/specs/edge-cloud-api.md`, `tokens.css`, `scripts/dev.sh`,
`scripts/demo.py`, `scripts/verify-auth.mjs`, and the constraints below. Those are the point of
the template.

## What this is

A runnable skeleton, not a product. Gatsby 5 / React 18 in front, an AWS
Amplify Gen 2 backend behind, one Cognito gate over the whole thing. The shape
is a deliberate extraction: the parts of a working D-LAB-5 application that
are worth inheriting, with the domain removed.

The tenancy is **Tenant** and **Space** (ADR-0005). A tenant (a family, a
home, a team) has admins: the Cognito group named exactly like its minted id
(`t-…`). A space has readers: the group named like its id (`s-…`); every
tenant has one `shared` space. One function, `tenants`, writes the rows and
the groups together. **Operators** (`app-admins`) create tenants and see
names; they read no tenant content. A space's content is one object in S3
(ADR-0004); what the tenant knows is an RDF A-Box per space (ADR-0007).

**Edges** link with the device flow (ADR-0006, `docs/specs/edge-cloud-api.md`):
an edge shows a code, a tenant admin approves it on `/link`, the edge gets a
device token bound to that tenant. Every edge route sits behind
`versionGate` (426 below `MIN_EDGE_VERSION`) and `verifyDeviceToken`, and takes
the tenant from the token row, never from the body. The edge half is
template-dlab5-edge (skill dlab5-edge-template).

> Treat this repository as public. Read `SECURITY.md` before committing.
> Never commit `amplify_outputs.json`, AWS account IDs or ARNs, `.env` files,
> or real names, emails and hostnames.

## Layout

```
backend/            Amplify Gen 2 backend. NOT an npm workspace — see ADR-0001.
packages/core/      Domain logic. Pure TS, no React, no AWS, no DOM.
packages/site/      The Gatsby 5 app (@dlab5/app-site).
docs/adr/           Architecture Decision Records. Read these first.
scripts/demo.py     Menu-driven demo: sandbox, a demo user, dev server.
scripts/dev.sh      Sandbox + Gatsby in one terminal. The usual entry point.
packages/i18n/      en (master), de, fr texts; the edges keep a copy.
packages/ontology/  T-Box, SKOS concepts, SHACL shapes for the A-Boxes.
backend/edge-release/  The edge installer and package, filled by the edge repo.
docs/specs/         The edge wire contract (DH-SPEC-100 profile).
scripts/rename.mjs  Turns this template into a project.
scripts/verify-auth.mjs   The only check that proves the gate against real AWS.
```

## Commands

```bash
npm install && npm --prefix backend install   # two installs; separate trees

npm run demo                        # menu: create/delete sandbox, demo user
npm run dev                         # sandbox + site, one terminal
npm run dev -- --web-only           # site alone, no AWS
npm run dev -- --profile work       # a different AWS profile
npm run dev -- --identifier qa      # a second, parallel sandbox

npm run build                       # must pass with NO amplify_outputs.json
npm test                            # packages/core, node --test
npm run backend:typecheck
npm run clean:web                   # after a global.css change — constraint 13

npm --prefix backend run sandbox:once     # one deploy, no watch
npm --prefix backend run sandbox:delete   # tear the sandbox down
npm run backend:sync-outputs              # copy outputs into the site by hand

APP_USER=… APP_PASSWORD=… npm run verify:auth   # ADR-0002 invariants, live
APP_USER=… APP_PASSWORD=… APP_TOTP_FILE=… npm run verify:edge   # tenant + edge path, live (17 checks; an operator; makes a tenant: sandbox only)
npm run rename -- --name "Fleet" --slug fleet --prefix fl --dry-run
```

`npm run demo` (`scripts/demo.py`) is the friendliest way in, and the one to
point a newcomer at. It surveys the environment first — Node, dependencies, AWS
credentials, region, inotify limits — and prints the fix for anything missing
rather than failing four minutes into a deploy. Then a menu: create the sandbox,
delete it, or just start the dev server, with the options that cannot work shown
dimmed and refusing with a reason. Creating also provisions a demo account you
can sign in as immediately:

    email     demo-user@example.com
    password  Demo-user$1

Both are constrained by Cognito rather than chosen. The username must be an
**email**, because `loginWith: { email }` makes email the pool's username
attribute. The password needs an **uppercase** letter — `defineAuth` passes no
password policy, so CDK emits none and the pool takes Cognito's own default.
Read off a deployed pool, that default is:

```json
{ "MinimumLength": 8, "RequireUppercase": true, "RequireLowercase": true,
  "RequireNumbers": true, "RequireSymbols": true }
```

`demo-user$1` satisfies every clause except the uppercase, which is the whole
reason for the capital D. Override either with `DEMO_EMAIL` / `DEMO_PASSWORD`. Relaxing the pool's policy to fit a nicer
password would weaken the template permanently to save one keystroke.

`npm run dev` (`scripts/dev.sh`) is the same thing without the menu, for when
you already know what you want. It exists because the sandbox and the site have an
ordering constraint: `ampx sandbox` writes `amplify_outputs.json` and the site
is useless without it. Run in two terminals, Gatsby usually wins the race,
finds no outputs and renders the "backend not configured" notice for the rest
of the session — which looks like a broken build and is only a race. The script
starts the sandbox, waits for the outputs, copies them in, then starts Gatsby,
and re-copies on every redeploy. It also checks the inotify limits of
constraint 10 before Gatsby has a chance to die of them.

`verify:auth` drives the real `aws-amplify/auth` client through the same
sequence `AuthGate` uses — `signIn`, the new-password challenge,
`confirmSignIn`, `fetchAuthSession`, `cognito:groups` — against whatever
`backend/amplify_outputs.json` points at. Add `--new-password '…'` for an
account still in `FORCE_CHANGE_PASSWORD`. Run it after any change to
`auth/resource.ts`, `backend.ts` or `AuthGate.tsx`. Everything else in this
repository proves the code agrees with itself; this is the only thing that
proves it agrees with AWS.

## Which AWS account does the sandbox deploy to?

**Nothing in this repository names an account, and nothing should.** The answer
differs per developer and per machine, and a committed account id is both wrong
for everyone else and something you then have to redact.

`ampx sandbox` uses the ordinary AWS SDK credential chain, first match wins:

1. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
2. `AWS_PROFILE`, or `--profile` passed through `npm run dev -- --profile <name>`
3. the `[default]` profile in `~/.aws/credentials` and `~/.aws/config`
4. SSO, then the EC2/ECS instance role

So the account is **whatever your shell already points at**. That is convenient,
and it is exactly how someone deploys a sandbox into production by accident, so
`npm run dev` prints the account, region, profile and sandbox identifier and
makes you look at them before anything is created. The region comes from the
same chain (`AWS_REGION`, then the profile's `region`); `ampx` refuses to deploy
without one.

Sandboxes are **per-person, not per-repo**. The stack is named
`amplify-<backendName>-<identifier>-<pathHash>`, where `<backendName>` comes
from `backend/package.json` and `<identifier>` defaults to your system
username. Two people therefore never collide, and one person can run several
with `--identifier`. A sandbox is a real deployment holding a real Cognito pool,
S3 bucket and DynamoDB tables — it costs a little and it outlives your terminal.
Delete it deliberately:

```bash
npm --prefix backend run sandbox:delete
```

## Non-obvious constraints

These will bite. Each is load-bearing and each has cost someone time.

1. **`backend/` must not become an npm workspace.** Gatsby needs graphql 16 and
   the Amplify data construct needs graphql 15; one hoisted tree cannot satisfy
   both. ADR-0001.
2. **`graphql: ^16` is a direct dependency of `packages/site` on purpose.**
   `aws-amplify` v6 drags in graphql 15 transitively. Whichever npm hoists is
   what `graphql-compose` resolves, and if 15 wins, `gatsby build` dies in
   `buildSchema` with *"Cannot create as TypeComposer …
   GraphQLScalarType(Date)"*. Naming 16 makes it win deterministically. Do not
   "clean up" that dependency — nothing imports it.
3. **`AuthGate` is mounted in `gatsby-ssr` as well as `gatsby-browser`**, via
   one shared `src/wrap-page-element.tsx`. Leaving it out of SSR breaks the
   build, because page components call `useSession()` and Gatsby would render
   them directly. The gate short-circuits on `typeof window === "undefined"`.
   ADR-0002.
4. **Amplify is configured in `gatsby-browser` only, never in `gatsby-ssr`.**
   `src/lib/amplify.ts` uses `require`, not `import … with { type: "json" }`,
   which Gatsby's Babel pipeline rejects. The missing-file warning during a
   build with no outputs is expected and handled.
5. **The build must succeed without `amplify_outputs.json`.** A frontend-only
   rebuild has no backend phase. `amplify.yml` tolerates the copy failing, and
   `AuthGate` renders its "backend not configured" notice.
6. **Tenant and space groups (`t-…`, `s-…`) are created at runtime by the
   `tenants` function**, never declared in `defineAuth` (a deploy per tenant)
   and never referenced from `defineStorage` (rules are static at deploy
   time). That is exactly why S3 goes through a proxy Lambda, and why
   `storage/resource.ts` has NO rule for `spaces/*`. ADR-0004, ADR-0005.
   A function that calls Cognito names the user pool by **wildcard ARN**
   (`userpool/*` in the account and region) and reads the real pool id from
   the caller's token issuer: naming `userPoolArn` closes a CloudFormation
   cycle (auth → data → auth).
7. **Adding a user to a group does not change their existing tokens.** Call
   `fetchAuthSession({ forceRefresh: true })` after a group change. This looks
   like a caching bug every single time.
8. **Writes are whole-object and carry an S3 `If-Match` ETag precondition.**
   That is the correctness mechanism for a space's object (ADR-0004); an A-Box
   uses a version number instead, and a stale write is a conflict to merge,
   never an overwrite (ADR-0007).
9. **`GATSBY_`-prefixed environment variables are public.** They are inlined
   into the bundle at build time.
10. **Local dev needs raised inotify limits.** Gatsby exhausts the default and
    dies with `ENOSPC: System limit for number of file watchers reached`:
    `sudo sysctl -w fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=1024`.
    Amplify's build container is unaffected.
11. **Client-only routes need an Amplify Hosting rewrite, which lives outside
    this repo.** `/w/*` is a `matchPath` route, so no file exists at
    `/w/<slug>/`. The catch-all rule serves the right HTML but returns 404,
    which needs an explicit 200 rewrite *ahead* of it — order matters:

    ```
    /w/<*>  ->  /w/index.html   200
    /<*>    ->  /index.html     404-200
    ```

    Adding another client-only route means adding another rule. There is no
    file in the repository that captures this; set it with
    `aws amplify update-app --custom-rules`. This is why `w.tsx` routes five
    views itself instead of registering five `matchPath` pages.
12. **The Amplify client in `packages/site` is deliberately untyped.**
    Importing `Schema` from `backend/amplify/data/resource` would pull
    `@aws-amplify/backend` — and graphql 15 — into the site's TypeScript
    program, undoing constraint 1. The result shapes in `src/lib/data.ts` are
    hand-written for that reason and must be kept in step with
    `data/resource.ts` **by hand**. Check with:
    `npx tsc --noEmit -p packages/site/tsconfig.json --listFiles | grep -c '@aws-amplify/backend/'` — must be 0.
13. **A change to `global.css` needs a clean build to appear.** `npm run build`
    reuses the cached stylesheet and emits the *identical* content hash, so the
    page renders with the old CSS and the edit looks like it did nothing:

    ```bash
    rm -rf packages/site/.cache packages/site/public && npm run build
    ```

    Confirm the change actually shipped rather than trusting the build:
    `grep -ro "app-your-class{[^}]*}" packages/site/public/*.css`. More than one
    `styles.*.css` in `public/` is the symptom.
14. **Every token in `tokens.css` must be defined in BOTH themes.** A component
    reading one that exists only in dark renders with an invalid value in
    light, and the failure is invisible until someone toggles. In particular
    `--app-surface-raised` must not equal `--app-bg` in light, or everything
    "raised" is painted invisible.

15. **Operators read no tenant content.** `app-admins` is not a back door:
    `objectProxy`, the storage rules and the models' `groupDefinedIn` rules all
    let in only the space's readers and the tenant's admins. Recovery needs a
    tenant admin, or a break-glass role whose use shows in CloudTrail. Do not
    "fix" an operator's empty screen by granting `app-admins` read.
16. **Admins and operators need two-step sign-in, checked with Cognito.** The
    pool's MFA is OPTIONAL (members who only read are not asked); `AuthGate`
    and every admin Lambda (`shared/mfa.ts`, AdminGetUser) require TOTP. An ID
    token says nothing about MFA, so never check it there.
17. **Amplify v6 REJECTS with the whole GraphQL result** when a resolver
    throws. `call()` in `lib/data.ts` unwraps it; a call that bypasses `call()`
    shows "[object Object]".
18. **The pairing tables live in the DATA stack.** `edgeDeviceApproval` (an
    AppSync resolver, data) reads them and edge functions (edge stack) read the
    data stack's tables. Data never points at edge; keep it so when an edge
    function writes a model of your own.
19. **A product's edge route that says "this item is gone" answers 410 WITH
    its own error code.** A bare 410 means "revoked", and edges forget their
    token on it.
20. **Raise `MIN_EDGE_VERSION` only after the new edge is released.** Every
    route, pairing included, answers 426 below it.
21. **After changing `packages/ontology`, run `node backend/scripts/sync-ontology.mjs`.**
    The Lambdas validate with a generated copy; `graph-shared/validate.test.ts`
    fails on drift.

## House conventions

- **TypeScript**, npm workspaces, Node 22 (`.nvmrc`).
- Package split: a pure-TS `core` with no
  React, and a thin `site`. Add a presentational `react` package when a second
  consumer appears, not before.
- Plain CSS with custom-property tokens in `packages/site/src/styles/tokens.css`.
  No Tailwind, no CSS-in-JS — the tokens must be readable from outside the
  React tree, because anything embedded later injects its own chrome.
- **One shell component.** The DHC Portal ended up with two and the seam still
  shows. If a screen needs a different frame, add a prop.
- **An id is minted, never derived from a name** (ADR-0003), and never rendered
  where a name belongs. Edges match spaces by NAME, because ids differ between
  sites (unless a tenant code made them the same, ADR-0005).
- Texts go into `packages/i18n` (English first, then German and French); the
  i18n test fails when a key or placeholder is missing.
- Compute in `packages/core`, render in `packages/site`. Anything in core is
  testable with `node --test` and reusable by a Lambda or a CLI; anything in a
  component is neither.
- Record decisions as ADRs in `docs/adr/`, numbered, with the *consequences*
  section actually filled in. That section is the one people read.
  A product with a cloud **and** edges may move its ADRs, roadmap and diagrams
  to a public `<product>-shared` repository with a GitHub Pages site, so both
  halves cite one place (the Mediathek: `mediathek-digitalhome-shared`, at
  docs.mediathek.digitalhome.cloud). The ontology's source stays in the cloud,
  whose build needs it; the shared repo keeps a checked copy. Make it from
  `d-lab-5/template-dlab5-shared`, and it appears on docs.dlab5.net: see the
  `dlab5-shared-docs` skill.
- Commits: see the `git-commit` skill. `stage` is the integration branch; `main`
  is only updated by a promotion PR.
