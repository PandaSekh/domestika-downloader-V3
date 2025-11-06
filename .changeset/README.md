# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## What is a changeset?

A changeset is a file that describes the changes you've made in your PR. It helps us:
- Track what changed in each release
- Automatically bump version numbers
- Generate changelogs
- Create GitHub releases

## How to add a changeset

1. **Create a changeset file** when you make changes:
   ```bash
   npm run changeset
   ```
   This will prompt you to:
   - Select the type of change (patch, minor, or major)
   - Write a summary of your changes

2. **Commit the changeset file** along with your code changes:
   ```bash
   git add .changeset/
   git commit -m "feat: add new feature"
   ```

## Changeset types

- **patch**: Bug fixes, small improvements (e.g., `fix: resolve download error`)
- **minor**: New features, enhancements (e.g., `feat: add subtitle language selection`)
- **major**: Breaking changes (e.g., `feat!: change API structure`)

## Important notes

- **Every PR must include a changeset** - CI will fail if a changeset is missing
- Changeset files are located in `.changeset/` directory
- Multiple changesets can be added in a single PR if needed
- Changesets are automatically consumed when PRs are merged to create releases

## Example changeset file

When you run `npm run changeset`, it creates a file like:

```markdown
---
"domestika-downloader": patch
---

Fix issue where multiple courses were not processed correctly
```

