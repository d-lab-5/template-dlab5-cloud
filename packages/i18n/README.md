# @dlab5/app-i18n

The interface texts of the site (and of its edges, which keep a copy), in
English (the master), German and French. One flat JSON object per language:
`"area.what": "Text with {placeholders}"`.

- Add a text to `en.json` first, then to `de.json` and `fr.json`. The test
  fails when a key or a placeholder is missing in any language.
- Words people type themselves (names of things, places) are not here: they
  live in the A-Box, with optional translations.
- The tenant and space nouns default to tenant/space (Mandant/Bereich,
  organisation/espace). `scripts/rename.mjs --tenant … --space …` rewrites the
  English ones; review German and French by hand after a rename.

The site's own template screens (the guest landing, the space views) are still
plain English: move their texts here as you replace them.
