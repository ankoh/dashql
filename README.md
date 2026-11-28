<p align="center">
  <img src="misc/logo-dashql-glyphs/logo.png" width=100>
</p>
<p align="center">
  <a href="https://github.com/ankoh/dashql/actions/workflows/on_push_main.yml"><img src="https://github.com/ankoh/dashql/actions/workflows/on_push_main.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/ankoh/dashql/actions/workflows/renovate.yml"><img src="https://github.com/ankoh/dashql/actions/workflows/renovate.yml/badge.svg" /></a>
  <a href="https://coverage.dashql.app"><img src="https://coverage.dashql.app/badge.svg" /></a>
  <a href="https://opensource.org/licenses/MPL-2.0"><img src="misc/badge_mpl2.svg?raw=true" /></a>
  <a href="https://get.dashql.app/latest.json"><img src="https://get.dashql.app/channels/latest/badge.svg" /></a>
</p>

---

### Building

```
# Vite dev server for the browser with HMR. It runs ibazel, the watcher of Bazel,
# in a separate output base.
pnpm dev

# For Electron renderer HMR, run these in separate terminals.
pnpm dev --mode electron
bazel run //packages/dashql-native:dev
# Override DASHQL_ELECTRON_RENDERER_URL if Vite uses another loopback HTTP origin.

# If you need demangled wasm stacktraces, run with
pnpm dev:debug

# We bundle the web app with two routers
# - '/'-paths for Cloudflare Pages -> :pages
# - '#/'-paths for native apps -> :reloc
bazel build //packages/dashql-app:pages
bazel build //packages/dashql-app:reloc

# Astro dev server for the website and blog (dashql.org) on http://localhost:9003.
# It runs from the node_modules of the workspace, run `pnpm install` once first.
bazel run //packages/dashql-org:dev
# Static build of the website for Cloudflare Pages
bazel build //packages/dashql-org:pages_deploy

# The native app can be cross-compiled for arm and x86
bazel run //packages/dashql-native:mac_package_arm64
bazel run //packages/dashql-native:mac_package_x86_64

# Test everything
bazel test //...

# Perf test a workbook: import a .dashql file into the app in Chromium and print the perf marks,
# the long frames and the renders per component (see "Perf marks" in docs/design/dashql_runtime.md)
bazel run //packages/dashql-app:perf_workbook -- path/to/workbook.dashql

# Many tests are backed by snapshots / fixtures
# /tests/snapshots/*.tpl.yaml are the input to generate /tests/snapshots/*.yaml
# Update a snapshot category after intentional changes:
bazel run //tests/snapshots/analyzer:update
bazel run //tests/snapshots/completion:update
bazel run //tests/snapshots/dataflow:update
bazel run //tests/snapshots/diff:update
bazel run //tests/snapshots/formatter:update
bazel run //tests/snapshots/parser:update
bazel run //tests/snapshots/planner:update
bazel run //tests/snapshots/profiles/hyper/tests:update
bazel run //tests/snapshots/profiles/progress:update
# The Trino plans and progress, both from the recordings
bazel run //tests/snapshots/profiles/trino/plans:update
bazel run //tests/snapshots/visualize:update
# Or all categories at once:
bazel run //tests/snapshots:update

# Upgrade the Rust crates declared in bazel/crates/*.MODULE.bazel
bazel run //scripts:repin_crates -- full

# Generate rust-project.json for rust-analyzer in IDEs (see docs/agents/rust_analyzer.md)
bazel run //scripts:rust_project

# Fetch test datasets
bazel build //tools/datasets:datasets
# Upload missing test datasets to data.dashql.app (requires R2 key)
bazel run //tools/datasets:sync

# Build and test the npm package
bazel build --config=release //packages/dashql:npm_tarball
bazel test --config=release //packages/dashql:all

```

---

### Continuous Deployment

- We're continuously deploying main to [dashql.app](https://dashql.app)
    - `//packages/dashql-app:pages` is published to Cloudflare Pages
    - We use aggressive caching with cache busting
    - Every release tag deploys the same web app to [stable.dashql.app](https://stable.dashql.app)
    - Any commit pushed to the branch `dev` deploys to [dev.dashql.app](https://dev.dashql.app), for integrations under development
- Native apps and update bundles are published to **get.dashql.app**
- We're maintaining release manifests under [get.dashql.app/stable.json](https://get.dashql.app/stable.json) and [get.dashql.app/latest.json](https://get.dashql.app/latest.json)
- The npm package `@akohn/dashql` is published for the branches `main`, `stable`, `dev`
- Hosted test datasets are published to **data.dashql.app** (R2 bucket `dashql-data`)
    - Built hermetically by `//tools/datasets` (hash-pinned sources -> DuckDB CLI) and mirrored with `bazel run //tools/datasets:sync`
    - Immutable versioned paths `data.dashql.app/<dataset>/v<version>/<file>.parquet`, plus a mutable `data.dashql.app/index.json` registry
- Our builds heavily rely on a bazel-remote cache server under [bazel-cache.dashql.app](https://bazel-cache.dashql.app)
- You can see bazel cache statistics [here](https://bazel-cache.dashql.app/public-dashboards/a9d003b26c7c4da6962c2c9bf3e5c329)
