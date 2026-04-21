# Logseq Marketplace Submission

These files are staged for submission to [logseq/marketplace](https://github.com/logseq/marketplace).

## Submission Steps

1. Fork `https://github.com/logseq/marketplace`.
2. Clone your fork locally.
3. Create the plugin package folder:
   ```bash
   mkdir -p packages/archivist-gg
   ```
4. Copy the staged files into that folder:
   ```bash
   cp manifest.json /path/to/marketplace-fork/packages/archivist-gg/
   cp ../icon.png /path/to/marketplace-fork/packages/archivist-gg/
   ```
5. Commit on a new branch and push:
   ```bash
   cd /path/to/marketplace-fork
   git checkout -b add-archivist-gg
   git add packages/archivist-gg
   git commit -m "feat: add Archivist plugin"
   git push origin add-archivist-gg
   ```
6. Open a PR against `logseq/marketplace:master` titled `Add plugin: Archivist`.

## Prerequisites

Before opening the PR, confirm the plugin repo has:

- A GitHub Release with an attached `.zip` asset (produced by `.github/workflows/publish.yml`).
- README with at least one screenshot or demo image.
- `LICENSE` file.
- `package.json` with a valid `logseq` block (`id`, `title`, `icon`).
- `icon.png` at the repo root (used by the marketplace listing).

The `repo` field in `manifest.json` must point to the public GitHub repo hosting the plugin (`owner/name`, no URL).
