---
name: Migrate Pages to R2
overview: Deploy the web app to a dedicated R2 bucket (`dashql-app`) via `publish-app` and `vacuum-app` commands. All branches (including main) deploy to `/branches/<name>/`. A Cloudflare URL rewrite rule serves root requests from `/branches/main/`. Start by testing with a feature branch; main stays on GitHub Pages until validated.
todos:
  - id: refactor-remote-access
    content: Parameterize `RemoteAccess` with env var prefix and add bucket name field; fix hardcoded `dashql-get` everywhere
    status: completed
  - id: fix-vacuum-bug
    content: Fix `canary_objects` -> `stable_objects` bug on line 105 of vacuum_command.rs
    status: completed
  - id: publish-app-cmd
    content: "Implement `publish-app` command: walk app dir, upload static then HTML, generate and upload manifest"
    status: completed
  - id: vacuum-app-cmd
    content: "Implement `vacuum-app` command: `--keep-branches` deletes stale branches and all unreferenced files"
    status: completed
  - id: bazel-and-ci
    content: Upload reloc artifact in build_trusted.yml, add publish_app.yml workflow, wire up on_push_other.yml
    status: completed
isProject: false
---

# Migrate GitHub Pages to R2 Bucket

## Strategy

All branches -- including `main` -- deploy to `/branches/<name>/` in the R2 bucket. A Cloudflare URL rewrite rule rewrites root requests (`dashql.app/...`) to `/branches/main/...`, so there is no special main-branch logic anywhere in the code.

The migration is **incremental**: we first test with a dedicated feature branch while main continues to deploy via GitHub Pages. Once validated, we wire up main to also publish to R2 and remove the GitHub Pages deployment.

## Vite Manifest: Not Needed

Vite has `build.manifest: true`, which generates `.vite/manifest.json` mapping input modules to output bundles. For our purposes this is **not needed**. The `publish-app` command walks the built output directory to discover all files. This is simpler, more complete (catches every file Vite emits), and requires no Vite config changes.

---

## R2 Bucket Layout (`dashql-app`)

```
dashql-app/
  branches/
    main/
      index.html                # main branch entry (Cloudflare rewrites / -> /branches/main/)
      oauth.html
      static/
        js/app.abc123.js
        css/app.def456.css
        ...
    my-feature/
      index.html                # feature branch entry
      oauth.html
      static/
        js/app.xyz987.js
        ...
  manifests/
    manifest.main.0.0.2-dev.42.json
    manifest.main.0.0.2-dev.43.json
    manifest.my-feature.0.0.2-dev.44.json
```

Every branch is fully self-contained under `branches/<name>/`. The `:reloc` Vite build uses `base: './'` (relative paths), so the app works correctly from any path prefix. Cloudflare serves `dashql.app/` from `branches/main/` via a URL rewrite rule.

---

## 1. Rust CLI Changes (`dashql-pack`)

### 1a. Refactor `RemoteAccess`

Currently `[remote_access.rs](packages/dashql-pack/src/remote_access.rs)` hardcodes env var names `DASHQL_GET_R2_*`. Refactor to accept a prefix and bucket name:

```rust
pub struct RemoteAccess {
    pub r2_endpoint: String,
    pub r2_access_key_id: String,
    pub r2_secret_access_key: String,
    pub bucket: String,
}

impl RemoteAccess {
    pub fn from_env(prefix: &str, bucket: &str) -> Result<RemoteAccess> {
        let endpoint_var = format!("{}_R2_ENDPOINT", prefix);
        let access_key_var = format!("{}_R2_ACCESS_KEY_ID", prefix);
        let secret_key_var = format!("{}_R2_SECRET_ACCESS_KEY", prefix);
        // ...
        Ok(RemoteAccess { ..., bucket: bucket.to_string() })
    }

    pub fn build_client(&self) -> aws_sdk_s3::Client { /* ... */ }
}
```

Usage:

- Existing native commands: `RemoteAccess::from_env("DASHQL_GET", "dashql-get")`
- New app commands: `RemoteAccess::from_env("DASHQL_APP", "dashql-app")`

Replace all hardcoded `"dashql-get"` strings in `[release.rs](packages/dashql-pack/src/release.rs)` and `[vacuum_command.rs](packages/dashql-pack/src/vacuum_command.rs)` with `remote_access.bucket`.

Extract the R2 client construction (currently duplicated between `publish_command.rs` and `vacuum_command.rs`) into `RemoteAccess::build_client()`.

### 1b. Fix existing bug in `vacuum_command.rs`

Lines 104-106 of `[vacuum_command.rs](packages/dashql-pack/src/vacuum_command.rs)` incorrectly read from `canary_objects` instead of `stable_objects` when deleting stable releases:

```105:106:packages/dashql-pack/src/vacuum_command.rs
    for v in delete_stable.iter() {
        canary_objects
```

Fix: change `canary_objects` to `stable_objects`.

### 1c. New `publish-app` command

New file `packages/dashql-pack/src/publish_app_command.rs`.

**CLI args:**

```rust
pub struct PublishAppArgs {
    #[arg(long, default_value = "false")]
    dry_run: bool,
    #[arg(long, required = true)]
    source_dir: PathBuf,       // for git version resolution
    #[arg(long, required = true)]
    app_dir: PathBuf,          // the built :reloc output directory
    #[arg(long, required = true)]
    branch: String,            // deploy to /branches/<branch>/
}
```

**Logic:**

1. Resolve git version via `collect_git_info` (reuse existing code)
2. Walk `app_dir` recursively to build a list of `(local_path, relative_path)` pairs
3. Compute R2 keys by prefixing each file with `branches/<branch>/`
4. Determine content type per file based on extension:
  - `.html` -> `text/html; charset=utf-8`
  - `.js` / `.mjs` -> `application/javascript`
  - `.css` -> `text/css`
  - `.wasm` -> `application/wasm`
  - `.json` -> `application/json`
  - `.svg` -> `image/svg+xml`
  - `.png` -> `image/png`
  - `.ico` -> `image/x-icon`
  - `.ttf` -> `font/ttf`
  - fallback -> `application/octet-stream`
5. Set `Cache-Control` headers:
  - Files under `static/` (cache-busted): `public, max-age=31536000, immutable`
  - HTML files: `no-cache`
6. Upload in two phases:
  - **Phase A:** Upload all `static/` files via concurrent `put_object` calls
  - **Phase B:** Upload HTML files (`index.html`, `oauth.html`) last -- ensures entry points only go live after all dependencies are available
7. Build and upload a manifest JSON to `manifests/manifest.<branch>.<version>.json`:

```json
{
  "branch": "my-feature",
  "version": "0.0.2-dev.44",
  "git_commit": "abc1234",
  "pub_date": "2026-04-03T12:00:00Z",
  "files": [
    "branches/my-feature/index.html",
    "branches/my-feature/oauth.html",
    "branches/my-feature/static/js/app.abc123.js",
    "branches/my-feature/static/css/app.def456.css"
  ]
}
```

The `files` list contains full R2 keys.

The command is purely additive -- it uploads files and overwrites the manifest via `put_object` (naturally idempotent). It never deletes anything. Re-uploading the same version (CI retry, force-push) simply overwrites the files and manifest. If the build output changed, the old files become orphans that `vacuum-app` will detect and clean up (they won't be referenced by any manifest).

### 1d. New `vacuum-app` command

New file `packages/dashql-pack/src/vacuum_app_command.rs`.

**CLI args:**

```rust
pub struct VacuumAppArgs {
    #[arg(long, default_value = "false")]
    dry_run: bool,
    #[arg(long, required = true, num_args = 1.., value_delimiter = ',')]
    keep_branches: Vec<String>,  // list of branch names to keep (e.g. "main,feat-x,feat-y")
}
```

**Logic:**

1. List all objects under `manifests/` prefix in the `dashql-app` bucket
2. Parse each manifest filename: `manifest.<branch>.<version>.json` -> extract branch name and version
3. Group manifests by branch
4. Partition branches into kept vs dead:
  - `dead_branches` = branches with manifests that are NOT in `--keep-branches`
  - `kept_branches` = branches that ARE in the list
5. For dead branches: collect all their manifests for deletion
6. For kept branches: download all their manifest JSONs, union their `files` arrays -> the "alive set"
7. List all objects under `branches/` prefix
8. Any object under `branches/` not in the alive set is dead (catches orphaned files from re-uploads, old deployments, or files never tracked by a manifest)
9. Batch-delete dead branch files + dead branch manifests

### 1e. Update CLI enum in `main.rs`

Add the new commands without renaming existing ones:

```rust
enum CliCommand {
    Version,
    Publish(PublishArgs),           // unchanged
    Vacuum(VacuumArgs),             // unchanged
    PublishApp(PublishAppArgs),      // new
    VacuumApp(VacuumAppArgs),       // new
}
```

---

## 2. Bazel and CI Changes

### 2a. Upload reloc artifact in `[build_trusted.yml](.github/workflows/build_trusted.yml)`

The `:reloc` target is already built by `bazel build --config=release //packages/...`. Add an artifact upload after the existing `dashql_app_pages` upload (around line 241):

```yaml
- uses: actions/upload-artifact@v7
  with:
    name: dashql_app_reloc
    path: ./bazel-bin/packages/dashql-app/reloc/
    retention-days: 1
```

### 2b. Add app publish workflow

Create a new workflow `[publish_app.yml](.github/workflows/publish_app.yml)`:

```yaml
name: Publish App

on:
    workflow_call:
        inputs:
            commit:
                required: true
                type: string
            branch:
                required: true
                type: string

jobs:
    app:
        name: Publish App
        runs-on: ubuntu-24.04
        steps:
            - uses: actions/checkout@v6
              with:
                  submodules: 'recursive'
                  fetch-depth: 0
                  ref: ${{ inputs.commit }}

            - name: Setup Bazel
              uses: ./.github/actions/setup-bazel
              with:
                  bazel-mtls-ca: ${{ secrets.BAZEL_CACHE_MTLS_CA }}
                  bazel-mtls-client-cert: ${{ secrets.BAZEL_CACHE_MTLS_CLIENT_CERT }}
                  bazel-mtls-client-key: ${{ secrets.BAZEL_CACHE_MTLS_CLIENT_KEY }}

            - name: Build DashQL Pack
              run: bazel build --config=release //packages/dashql-pack:pack

            - uses: actions/download-artifact@v8
              with:
                  name: dashql_app_reloc
                  path: ${{ runner.temp }}/artifacts/reloc

            - name: Publish app
              env:
                  DASHQL_APP_R2_ENDPOINT: ${{ secrets.R2_DASHQL_APP_ENDPOINT }}
                  DASHQL_APP_R2_ACCESS_KEY_ID: ${{ secrets.R2_DASHQL_APP_ACCESS_KEY_ID }}
                  DASHQL_APP_R2_SECRET_ACCESS_KEY: ${{ secrets.R2_DASHQL_APP_SECRET_ACCESS_KEY }}
              run: |
                  bazel run --config=release //packages/dashql-pack:pack -- publish-app \
                    --source-dir $GITHUB_WORKSPACE \
                    --app-dir ${{ runner.temp }}/artifacts/reloc \
                    --branch ${{ inputs.branch }}

            - name: Cleanup stale branches
              env:
                  DASHQL_APP_R2_ENDPOINT: ${{ secrets.R2_DASHQL_APP_ENDPOINT }}
                  DASHQL_APP_R2_ACCESS_KEY_ID: ${{ secrets.R2_DASHQL_APP_ACCESS_KEY_ID }}
                  DASHQL_APP_R2_SECRET_ACCESS_KEY: ${{ secrets.R2_DASHQL_APP_SECRET_ACCESS_KEY }}
              run: |
                  ACTIVE_BRANCHES=$(git branch -r --format='%(refname:short)' | sed 's|origin/||' | paste -sd, -)
                  bazel run --config=release //packages/dashql-pack:pack -- vacuum-app \
                    --keep-branches "$ACTIVE_BRANCHES"
```

This workflow is reusable for all branches including main. The same `publish_app.yml` works for both `on_push_other.yml` (feature branches) and eventually `on_push_main.yml` (main).

### 2c. Update `[on_push_other.yml](.github/workflows/on_push_other.yml)`

Add a publish step calling the new workflow:

```yaml
jobs:
    build:
        name: Build
        uses: ./.github/workflows/build_trusted.yml
        with:
            commit: ${{ github.sha }}
            signed: false
        secrets: inherit

    publish:
        name: Publish App
        uses: ./.github/workflows/publish_app.yml
        with:
            commit: ${{ github.sha }}
            branch: ${{ github.ref_name }}
        needs:
            - build
        secrets: inherit
```

### 2d. No changes to main-branch workflows (for now)

`[on_push_main.yml](.github/workflows/on_push_main.yml)`, `[on_push_tag.yml](.github/workflows/on_push_tag.yml)`, and the `pages` job in `[publish.yml](.github/workflows/publish.yml)` remain **unchanged** until the R2 pipeline is validated. Wiring up main is a one-line addition of `publish_app.yml` to `on_push_main.yml` with `branch: main`.

---

## 3. Cloudflare / Infrastructure Setup (Manual)

- **Create R2 bucket** `dashql-app` in the Cloudflare dashboard
- **Create R2 API token** with read/write access to `dashql-app`
- **Add GitHub Actions secrets**: `R2_DASHQL_APP_ENDPOINT`, `R2_DASHQL_APP_ACCESS_KEY_ID`, `R2_DASHQL_APP_SECRET_ACCESS_KEY`
- **Set up Custom Domain** on the R2 bucket to serve `dashql.app`
- **Add Cloudflare URL rewrite rule**: rewrite `dashql.app/`* to `/branches/main/`* (so root requests serve the main branch)
- **Configure Cloudflare Cache Rules**:
  - `branches/*/static/`*: `Cache-Control: public, max-age=31536000, immutable`
  - `branches/*/*.html`: `Cache-Control: no-cache`

---

## 4. Files Changed Summary

- `packages/dashql-pack/src/main.rs` -- Add `PublishApp`, `VacuumApp` variants
- `packages/dashql-pack/src/publish_app_command.rs` -- **New file** - publish-app logic
- `packages/dashql-pack/src/vacuum_app_command.rs` -- **New file** - vacuum-app logic (branch cleanup + orphan GC)
- `packages/dashql-pack/src/remote_access.rs` -- Parameterize env var prefix, add bucket field, add `build_client()`
- `packages/dashql-pack/src/release.rs` -- Replace hardcoded `"dashql-get"` with `remote_access.bucket`
- `packages/dashql-pack/src/vacuum_command.rs` -- Replace hardcoded `"dashql-get"`, fix stable/canary bug
- `.github/workflows/build_trusted.yml` -- Upload reloc artifact
- `.github/workflows/publish_app.yml` -- **New file** - app publish workflow (reusable for all branches)
- `.github/workflows/on_push_other.yml` -- Call `publish_app.yml` after build

