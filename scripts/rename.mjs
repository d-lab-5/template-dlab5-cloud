#!/usr/bin/env node
/**
 * Turns this template into a project.
 *
 *   node scripts/rename.mjs \
 *     --name "Fleet" --slug fleet --prefix fl \
 *     --domain fleet.dlab5.net --repo d-lab-5/fleet-dlab5-net
 *
 * Add --dry-run to see the substitutions and the files they touch without
 * writing anything.
 *
 * What it rewrites, and why each one matters:
 *
 *   app-        → <prefix>-    CSS classes, custom properties, Cognito group
 *                              names, the data-*-theme attribute and the
 *                              localStorage key. These have to move together:
 *                              a stylesheet renamed without the attribute
 *                              produces a page with no theme at all.
 *   @dlab5/app-* → @dlab5/<slug>-*   package names, plus every `-w` reference
 *                              in the root scripts that names them.
 *   template.dlab5.net → <domain>
 *   template.dlab5     → <name lowercased>.dlab5    the brand in the rail
 *   D-LAB-5 Template   → <name>                     titles and metadata
 *   d-lab-5/template-dlab5-cloud → <repo>             the Source link
 *
 * What it does NOT do, deliberately:
 *
 *   - Rename `Workspace`. That is a domain noun and only you know what yours
 *     is called. Renaming it mechanically would touch the DynamoDB model, the
 *     GraphQL API and the /w/ route, and half of those are decisions.
 *   - Touch docs/adr/. Those record decisions this project made; a fork
 *     inherits them and should edit them by reading them.
 *   - Delete the placeholder screens. Deleting is your job, and it is the
 *     part where you decide what the app actually is.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "public",
  "dist",
  ".amplify",
  ".idea",
  "temp",
]);

// Rewriting a lockfile or a binary is never right, and rewriting the ADRs
// would erase the reasoning a fork is supposed to inherit.
//
// amplify_outputs.json is the subtle one, and it bit during a live run. It is
// GENERATED, it is git-ignored, and it describes infrastructure that already
// exists — a deployed pool whose group really is called `app-admins`. Renaming
// the file makes it claim `fl-admins` while the pool it points at says
// otherwise, and `verify:auth` then passes its group assertion against a lie.
// The file regenerates correctly on the next deploy; it must not be edited.
const SKIP_FILES = new Set([
  "package-lock.json",
  "rename.mjs",
  "amplify_outputs.json",
  "amplify_outputs.d.ts",
  "gatsby-types.d.ts",
]);
const SKIP_PATH_PREFIXES = ["docs/adr/"];

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".css", ".json", ".md", ".yml", ".yaml", ".html", ".svg", ".txt", ".example",
  // Shell too. scripts/dev.sh has nothing to rename today, which is exactly
  // why leaving it out would go unnoticed until a fork put a group name or a
  // token prefix in it.
  ".sh",
  // Python, and this one is not hypothetical: scripts/demo.py hard-codes the
  // admin group name, so a fork that skipped it would ship a demo script
  // adding its user to a Cognito group that no longer exists.
  ".py",
]);

/* -- arguments ------------------------------------------------------------- */

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[++i];
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!args.name || !args.slug || !args.prefix) {
  fail(
    "usage: node scripts/rename.mjs --name \"Fleet\" --slug fleet " +
      "--prefix fl [--domain fleet.dlab5.net] [--repo d-lab-5/fleet-dlab5-net] " +
      "[--dry-run]"
  );
}

if (!/^[a-z][a-z0-9-]*$/.test(args.slug)) {
  fail(`--slug must be lowercase kebab-case, got "${args.slug}"`);
}
// The prefix becomes a CSS identifier, a custom-property segment and a Cognito
// group name. Two to four letters keeps it legible in all three.
if (!/^[a-z]{2,6}$/.test(args.prefix)) {
  fail(`--prefix must be 2-6 lowercase letters, got "${args.prefix}"`);
}
if (args.prefix === "app") {
  fail("--prefix is already \"app\"; there would be nothing to rename.");
}

const domain = args.domain || `${args.slug}.dlab5.net`;
const repo = args.repo || `d-lab-5/${args.slug}-dlab5-cloud`;
const brand = args.slug;

/* -- a clean tree ---------------------------------------------------------- */

/*
 * Refusing on a dirty tree is not fussiness. This rewrites a few hundred lines
 * across sixty files; if it gets something wrong, `git checkout .` has to be a
 * complete undo, and it only is when there was nothing else uncommitted.
 */
if (!args.dryRun) {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (status.trim()) {
      fail(
        "The working tree has uncommitted changes. Commit or stash them " +
          "first, so that `git checkout .` can undo this cleanly.\n  " +
          "(Run with --dry-run to preview without writing.)"
      );
    }
  } catch (err) {
    if (err?.status === undefined) throw err;
    // Not a git repository. Allowed — the template ships before its fork has
    // one — but say so, because the undo above will not be available.
    console.warn("  Not a git repository; there will be no easy undo.\n");
  }
}

/* -- the substitutions ----------------------------------------------------- */

/*
 * Order matters. The longest, most specific patterns run first, so that
 * `@dlab5/app-core` is not half-rewritten by the bare `app-` rule below it.
 */
const RULES = [
  ["d-lab-5/template-dlab5-cloud", repo],
  ["template-dlab5-cloud", repo.split("/").pop()],
  ["template.dlab5.net", domain],
  ["template.dlab5", `${brand}.dlab5`],
  ["@dlab5/app-", `@dlab5/${args.slug}-`],
  ["D-LAB-5 Template", args.name],
  ["data-app-theme", `data-${args.prefix}-theme`],
  ["'app-theme'", `'${args.prefix}-theme'`],
  ['"app-theme"', `"${args.prefix}-theme"`],
  ["APP_USER", `${args.prefix.toUpperCase()}_USER`],
  ["APP_PASSWORD", `${args.prefix.toUpperCase()}_PASSWORD`],
  // Last, and the broad one: CSS classes, custom properties, Cognito groups.
  ["app-", `${args.prefix}-`],
  // `--app-` is covered by the rule above; `appStorage` is not.
  ["appStorage", `${args.slug.replace(/-/g, "")}Storage`],
];

/*
 * Strings the broad `app-` rule would corrupt.
 *
 * `--app-id` and `$AWS_APP_ID` in amplify.yml are Amplify's own CLI flag and
 * build variable; rewriting them to `--fl-id` produces a build that fails in
 * the backend phase with an unrecognised option, which is a long way from
 * where the mistake was made. Each one is swapped for a sentinel before the
 * rules run and swapped back afterwards.
 *
 * Add to this list rather than narrowing the `app-` rule: the rule has to stay
 * broad, because `.app-rail`, `--app-bg` and `app-admins` are all things it
 * must catch and no single pattern distinguishes them from a false positive.
 */
const PROTECTED = ["--app-id", "AWS_APP_ID"];

const SENTINEL = (i) => `\u0000PROTECTED${i}\u0000`;

function rewrite(text) {
  let out = text;
  PROTECTED.forEach((token, i) => {
    out = out.split(token).join(SENTINEL(i));
  });
  for (const [from, to] of RULES) {
    out = out.split(from).join(to);
  }
  PROTECTED.forEach((token, i) => {
    out = out.split(SENTINEL(i)).join(token);
  });
  return out;
}

/* -- walk ------------------------------------------------------------------ */

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* files(full);
      continue;
    }
    if (SKIP_FILES.has(entry)) continue;
    const rel = relative(ROOT, full);
    if (SKIP_PATH_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const dot = entry.lastIndexOf(".");
    const ext = dot === -1 ? "" : entry.slice(dot);
    // Extensionless dotfiles (.gitignore, .nvmrc) are text and worth visiting.
    if (ext && !TEXT_EXTENSIONS.has(ext)) continue;
    yield full;
  }
}

let changed = 0;
let touched = 0;

for (const file of files(ROOT)) {
  let before;
  try {
    before = readFileSync(file, "utf8");
  } catch {
    continue; // unreadable or binary
  }
  const after = rewrite(before);
  if (after === before) continue;

  touched += 1;
  const hits = before.split("\n").filter((l) => rewrite(l) !== l).length;
  changed += hits;
  console.log(`  ${relative(ROOT, file)}  (${hits} line${hits === 1 ? "" : "s"})`);
  if (!args.dryRun) writeFileSync(file, after);
}

console.log(
  `\n  ${args.dryRun ? "Would change" : "Changed"} ${changed} lines in ` +
    `${touched} files.\n`
);

if (!args.dryRun && touched > 0) {
  console.log(`  Next:

    rm -rf node_modules packages/*/node_modules package-lock.json
    npm install && npm --prefix backend install
    npm test && npm run build

  A reinstall is not optional: the workspace package names changed, so the
  symlinks in node_modules still point at @dlab5/app-* and nothing resolves.

  Then, by hand:
    - README.md — its first section describes a template, and yours is not
      one any more.
    - packages/site/src/components/Shell.tsx — railItems() and toolItems().
    - packages/site/src/pages/w.tsx — the VIEWS list and the placeholders.
    - packages/site/src/components/GuestLanding.tsx — the hero copy and <Art/>.
    - docs/adr/ — read them, keep what still holds, add your own.
`);
}
