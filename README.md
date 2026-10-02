# D-LAB-5 cloud template

A runnable skeleton for the **cloud** half of a D-LAB-5 cloud-and-edge product:
**Gatsby 5 / React 18** in front, an **AWS Amplify Gen 2** backend behind, one
Cognito gate over the whole thing, **tenants with spaces**, and an API that
**edges** link to. Fork it, rename it, and start on the part that is actually
yours.

The edge half — the local app a person, a home server or a robot runs — is
[`template-dlab5-edge`](https://github.com/d-lab-5/template-dlab5-edge). The
patterns both implement are an ArchiMate blueprint,
[`cloud-edge-platform.ttl`](https://github.com/d-lab-5/blueprinting-dlab5-net/blob/stage/docs/patterns/cloud-edge-platform.ttl)
in blueprinting-dlab5-net, with the Mediathek and DigitalHome.Cloud as its two
instances. (This repository was `template-dlab5-net`; GitHub redirects the old
name.)

It is deliberately not a product. What it carries is the shape — and the dozen
constraints that shape has already cost someone a day each to discover,
recorded in [`docs/adr/`](docs/adr/).

Working guidance for Claude Code lives outside the repository, as the
`dlab5-cloud-template` skill, so it follows you into every fork instead of
being copied once and left to drift. `CLAUDE.md` is git-ignored here: keep a
local one if you want, it will not be committed.

## What you get

| | |
|---|---|
| **Auth** | Cognito user pool, no guest tier, no self-signup, admin-created accounts with the new-password challenge handled. One gate at the root, so a new page cannot be unprotected. |
| **Tenancy** | `Tenant` and `Space`, each a Cognito group named like its minted id (`t-…` admins, `s-…` readers), created by one function together with its rows. Operators create tenants and read no content. Two-step sign-in for admins and operators. ADR-0005. |
| **Data** | A space's content is an object in S3 behind the proxy; what a tenant knows is an RDF A-Box per space, validated against SHACL shapes (`packages/ontology`) and versioned. ADR-0004, ADR-0007. |
| **Edges** | The RFC 8628 device flow of DigitalHome's edges: an edge shows a code, a tenant admin approves it on `/link`, the edge gets a revocable token for that tenant. A version gate (426), A-Box sync, model downloads, and installers offered from Settings. ADR-0006, [`docs/specs/edge-cloud-api.md`](docs/specs/edge-cloud-api.md). |
| **Storage** | An `objectProxy` Lambda that is the real authorization boundary, hands back presigned GETs, and enforces an `If-Match` precondition on every write. |
| **Frontend** | One shell component, a collapsible rail with a placeholder menu, a light/dark theme with no flash on load, a token palette defined in both themes, English/German/French (`packages/i18n`), security headers (`customHttp.yml`), and Settings for tenants, members, edges and two-step sign-in. |
| **Build** | An `amplify.yml` whose comments encode why every line is the way it is. The build passes with no backend deployed. |
| **Dev loop** | `npm run demo` — a guided menu that checks the environment, deploys a sandbox, makes a demo user and starts the dev server. `npm run dev` is the same without the menu. |
| **Tests** | `node --test` over `packages/core`, `packages/i18n` and `packages/ontology`; `tsx --test` over the backend functions (version gate, token expiry, tenant codes, A-Box validation); `verify-auth.mjs` for the live sign-in path. |

## Getting started

```bash
nvm use                                        # Node 22
npm install && npm --prefix backend install    # separate trees — ADR-0001
npm run demo                                   # guided menu — start here
```

`npm run demo` checks your environment first (Node, dependencies, AWS
credentials, region, file watchers) and prints the fix for anything missing,
rather than failing four minutes into a deploy. Then it offers:

```
  1  Create sandbox  — deploy, make the demo user, start the dev server
  2  Delete sandbox           (no sandbox to delete)
  3  Start dev server only    (deploy one first)
  0  Exit
```

Options that cannot work yet are dimmed and say why. Creating the sandbox also
provisions an account you can sign in as straight away:

| | |
|---|---|
| email | `demo-user@example.com` |
| password | `Demo-user$1` |

Both are shaped by Cognito, not by preference: the username must be an email
(the pool signs in by email), and the password needs an uppercase letter (the
pool's default policy wants upper, lower, digit and symbol). Override with
`DEMO_EMAIL` / `DEMO_PASSWORD`.

Once you know the ropes, `npm run dev` is the same thing without the menu — it
deploys the sandbox, wires its outputs into the site, starts Gatsby on
http://localhost:8000, and re-wires on every redeploy.

No AWS, or you only want the frontend:

```bash
npm run dev -- --web-only
```

You will then see the "backend not configured" notice. That is correct, and the
build passing in that state is a property worth keeping — a frontend-only
rebuild must never fail the branch.

Once the backend is up, create a user in the Cognito console and add them to
`app-admins` (the demo user already is). There is no sign-up: the landing page
is the sign-in page. An operator sets up two-step sign-in on first sign-in,
then creates the first tenant in Settings → Operator, naming its first admin.

### Which AWS account?

Nothing in this repository names one. `ampx sandbox` uses the ordinary AWS SDK
credential chain — `AWS_ACCESS_KEY_ID…`, then `AWS_PROFILE` or `--profile`,
then the `[default]` profile in `~/.aws`, then SSO or an instance role — so the
account is whatever your shell already points at.

That is convenient and it is how a sandbox ends up in production by accident,
so `npm run dev` prints the account, region, profile and sandbox name and makes
you look before it creates anything:

```
▸ AWS
  account     123456789012
  region      eu-central-1
  profile     default
  sandbox     your-username
```

Use a different one with `npm run dev -- --profile work`, and run a second
sandbox side by side with `--identifier qa`. Sandboxes are per-person: the
stack name embeds your system username, so two people never collide.

A sandbox is a real deployment holding a real Cognito pool, S3 bucket and
DynamoDB tables. It costs a little and it outlives your terminal — Ctrl-C
stops the dev server, not the backend. Remove it deliberately:

```bash
npm --prefix backend run sandbox:delete
```

## Forking it

```bash
node scripts/rename.mjs --name "Fleet" --slug fleet --prefix fl \
  --domain fleet.dlab5.net --repo d-lab-5/fleet-dlab5-cloud \
  --tenant Household --space Vault --dry-run
```

The script rewrites the CSS prefix, the design tokens, the Cognito group names,
the theme attribute and storage key, the package names, the domain and the
titles — all of which have to move together — and, with `--tenant`/`--space`,
the English interface nouns (the models and ids stay `Tenant`/`Space`,
`t-`/`s-`; German and French are yours to adjust). Drop `--dry-run`, then reinstall,
because the workspace package names changed:

```bash
rm -rf node_modules packages/*/node_modules package-lock.json
npm install && npm --prefix backend install && npm test && npm run build
```

What is placeholder and expected to go: the five stub views in
`packages/site/src/pages/w.tsx`, the menu arrays in `Shell.tsx`, the hero copy
in `GuestLanding.tsx`, the placeholder ontology in `packages/ontology`, and
this README.

What should survive untouched, because it is the point of the template:
`AuthGate`, `lib/amplify.ts`, `useTheme`, `gatsby-ssr.tsx`, `gatsby-node.ts`,
`amplify.yml`, the `objectProxy` Lambda, the hardening in `backend.ts`, the
`tenants` and edge functions, `tokens.css`, and the `scripts/`.

## Stack

Gatsby 5 · React 18 · TypeScript · AWS Amplify Gen 2 · Cognito · AppSync ·
DynamoDB · S3 · API Gateway (HTTP) · RDF/SHACL · npm workspaces · Node 22.

## Licence

**GPL-3.0-or-later** — see [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT).

This is a template, so the choice reaches further than usual: **anything forked
from it inherits GPL-3.0**, and a project built on it must be free software
too. That is the intent. If you need a permissive licence for a particular
piece of work, this template is not the starting point for it.
