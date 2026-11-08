# The edge release

Deployed into the site's private edge-release bucket (backend.ts), and handed
to tenant admins as 15-minute links by the `edgeRelease` query (Settings →
Edges → Install an edge).

This folder is FILLED BY THE EDGE REPOSITORY: its `scripts/publish-to-cloud.sh`
builds the package, writes the installers with the package's SHA-256, and
updates `release.json`. Do not edit those files here by hand.

`models/<set>/` (AI models and other large files an edge fetches on its first
start) is NOT in git: upload it to the bucket by hand, with a
`manifest.json` listing each file's name, size and SHA-256.
