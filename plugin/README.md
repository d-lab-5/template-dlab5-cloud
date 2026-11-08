# dlab5-cloud-template

The cloud template's own agent skill. It lives with the template because it describes the template. When the template changes, the skill changes in the same pull request. A product made with `scripts/rename.mjs` drops this folder and loads the skill from the catalogue.

**Install** from the D-LAB-5 catalogue:

```
/plugin marketplace add d-lab-5/agent-skills
/plugin install dlab5-cloud-template@d-lab-5
```

**Change a skill** here, in its one home. Then bump `version` in
`.claude-plugin/plugin.json`, or installed copies never see the change. Try a
working copy with `claude --plugin-dir plugin`. Never copy this skill into
another repository: point to it instead.
