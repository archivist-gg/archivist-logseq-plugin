---
name: release
description: Build and publish a GitHub release for the archivist-logseq plugin with all required distribution files
user_invocable: true
---

# Release

Build the plugin and create a GitHub release with all files needed for users to install directly (no `npm install` or build step required).

## Arguments

- `<version>` (optional) — semver version to release (e.g. `0.6.0`). If omitted, bumps the patch version from `package.json`.

## Steps

### 1. Determine Version

If a version argument was provided, use it. Otherwise, read the current version from `package.json` and bump the patch number (e.g. `0.5.1` -> `0.5.2`).

Ask the user to confirm the version before proceeding.

### 2. Update Version in package.json

Update the `"version"` field in `package.json` to the new version.

### 3. Build

```bash
cd /Users/shinoobi/w/archivist-logseq && npm run build
```

If the build fails, stop and report the error. Do not proceed.

### 4. Run Tests

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run
```

If tests fail, stop and report. Do not proceed.

### 5. Stage the Release Zip

Create a temporary directory and copy exactly these files into it:

```bash
RELEASE_DIR=$(mktemp -d)/archivist-logseq-plugin-<version>

mkdir -p "$RELEASE_DIR"
cp -r dist/ "$RELEASE_DIR/dist/"
cp package.json "$RELEASE_DIR/"
cp icon.png "$RELEASE_DIR/"
cp README.md "$RELEASE_DIR/"
cp LICENSE "$RELEASE_DIR/"
```

Then create the zip:

```bash
cd "$(dirname "$RELEASE_DIR")"
zip -r archivist-logseq-plugin-<version>.zip "archivist-logseq-plugin-<version>/"
```

The zip must contain:
- `dist/` — built plugin assets (index.html + JS chunks)
- `package.json` — plugin metadata (main, logseq config)
- `icon.png` — plugin icon
- `README.md` — documentation
- `LICENSE` — license file

The zip must NOT contain:
- `node_modules/`
- `src/` (source code)
- `tests/`
- `sidecar/` (if it exists)
- `.claude/`, `.gitnexus/`, `.superpowers/`
- Any dotfiles

### 6. Commit and Tag

```bash
cd /Users/shinoobi/w/archivist-logseq
git add package.json
git commit -m "chore: release v<version>"
git tag "v<version>"
```

### 7. Push

Ask the user for confirmation, then:

```bash
git push origin master
git push origin "v<version>"
```

### 8. Create GitHub Release

```bash
gh release create "v<version>" \
  "<path-to-zip>" \
  --title "v<version>" \
  --generate-notes
```

### 9. Report

Print:
- Release URL (from `gh release view`)
- Zip file size
- Contents of the zip (file listing)
- Installation instructions for users:
  ```
  1. Download archivist-logseq-plugin-<version>.zip from the release
  2. Extract the zip
  3. In Logseq: Plugins -> Load unpacked plugin -> select the extracted folder
  ```

### npm script alternative

You can also add a `release` script to `package.json` for quick access:

```json
"scripts": {
  "release": "npm run build && npm test"
}
```

But the full release flow (version bump, tag, GitHub release) should always go through this skill to ensure all steps are followed.
