---
name: release-process
description: Use when asked to cut an OpenNeato release, generate release notes, dispatch release.yml, prepare a GitHub release, or reason about RELEASE_PROCESS.md.
---

# Release Process

Use `RELEASE_PROCESS.md` as the source of truth. This skill only adds agent-specific guardrails.

## Workflow

1. Read `RELEASE_PROCESS.md` before taking release actions.
2. Use `gh` for GitHub release, workflow, PR, and tag operations.
3. Inspect the latest stable release and commit range before generating notes:

```bash
gh release list --exclude-pre-releases --limit 1
```

4. Identify contributors: collect commit authors from the range, then examine merged PRs (`gh pr list --state merged`) for testers and non-code contributors who helped with testing, feedback, or validation. Deduplicate into a single list.
5. Generate release notes from user-facing commits only, following the exact format in `RELEASE_PROCESS.md`. Include a "Contributors" section with all identified contributors.
6. Show the release notes preview and ask for explicit approval before dispatching `release.yml`.
7. Dispatch the release workflow only after approval:

```bash
gh workflow run release.yml -f release_tag="v<VERSION>" -f release_notes="<NOTES>" -f draft=true -f prerelease=false
```

## Guardrails

- Do not publish or dispatch a release without explicit approval after preview.
- Do not use patch versions; releases use major.minor only.
- Do not delete releases or prereleases as part of normal release creation unless explicitly asked.
- For stale prerelease cleanup, use the `cleanup-stale-prereleases` skill.
- Keep `RELEASE_PROCESS.md` authoritative if this skill and the document disagree.
