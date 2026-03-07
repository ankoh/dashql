# Vite + rules_js (Bazel) migration

This document describes the Vite-based app build that runs under Bazel using rules_js. It provides hot-module reloading (HMR) for development and cache-busted production builds without NODE_PATH patches in the rules.

## Overview

- **Dev (HMR):** `bazel run //packages/dashql-app:vite_dev` — runs Vite dev server with HMR. BUILD passes `DASHQL_CORE_DIST`, `DASHQL_COMPUTE_DIST`, `DASHQL_PROTOBUF_DIST` (runfiles-relative); launcher sets `NODE_PATH` from runfiles `node_modules` and resolves @ankoh/* to absolute paths.
- **Build (reloc):** `bazel build //packages/dashql-app:reloc` — output in `dist/` with content-hashed filenames (`[name].[hash].js`, etc.).
- **Build (pages):** `bazel build //packages/dashql-app:pages` — same with `base: '/'` for path-based routing.

## Prerequisites

1. **Adding or changing npm packages**  
   pnpm is the primary package manager. Add the package to the root `package.json` or to `packages/dashql-app/package.json` (or another workspace), then run:

   ```bash
   pnpm install
   ```

   Then run `bazel build //packages/dashql-app:reloc` (or your target). The `npm_translate_lock` extension reads `package.json` and `pnpm-lock.yaml`; when those inputs change, the extension re-runs and the npm repo is updated. You should not need `bazel clean` or `--expunge` when adding packages. If a new package is still not found, run `bazel clean` and build once; use `bazel clean --expunge` only if that fails.

2. **Core, Compute, and Protobuf built**  
   Build `@ankoh/dashql-core`, `@ankoh/dashql-compute`, and `@ankoh/dashql-protobuf` before running the app (e.g. `make core_js_o2`, `make compute_wasm_o3`, and `bazel build //packages/dashql-protobuf:dist`). The Vite launcher resolves @ankoh/* from direct paths (`DASHQL_CORE_DIST`, `DASHQL_COMPUTE_DIST`, `DASHQL_PROTOBUF_DIST`) set by BUILD; no overlay. Protobuf is built via buf in Bazel (gen + dist); see AGENTS.md.

## Sandbox

Vite uses `root: process.cwd()` when `DASHQL_NODE_PATH_OVERLAY` is set so the build stays in the action directory. The Vite targets use `tags = ["no-sandbox"]` because the runfiles `node_modules` layout (symlinks / `.aspect_rules_js`) is not fully resolvable inside the sandbox—Rollup fails to resolve bare specifiers like `react/jsx-runtime` when the action is sandboxed.

## EACCES on dist/ (permission denied)

The Vite build uses a **custom rule** that passes the declared output path via `VITE_OUT_DIR`, so Vite writes to the exact directory Bazel provides. This avoids EACCES without `--experimental_writable_outputs`.

If you still see:

```text
EACCES: permission denied, open '.../bazel-out/.../bin/packages/dashql-app/dist/oauth.html'
```

you can either:

1. **Use writable outputs** (if your Bazel supports it):

   ```bash
   bazel build --config=vite //packages/dashql-app:reloc
   ```
   This sets `--experimental_writable_outputs`.

2. **Run the build locally** (no experimental flag):

   ```bash
   bazel build --config=vite_local //packages/dashql-app:reloc
   ```
   This sets `--spawn_strategy=local` so the action runs in a context where the output directory is writable.

As a last resort, try `bazel clean` and rebuild once.

## How it works

- **Paths from Bazel:** Build targets are created with `build_modes = [("reloc", "reloc"), ("pages", "pages")]` (mode, name). The rule sets `env = { "DASHQL_CORE_DIST": "packages/dashql-core-api/dist_opt", ... }` (runfiles-relative). Dev server `js_binary` sets the same env and includes core/compute/protobuf dists in data. npm is discovered from runfiles in the launcher.
- **Launcher (`bazel/vite/vite_dev_server.cjs`):** Resolves npm from runfiles (or `DASHQL_NPM_NODE_MODULES`), resolves `DASHQL_*_DIST` to absolute paths, sets `NODE_PATH`, and spawns Vite.
- **Vite config (`vite.config.ts`):** Uses `DASHQL_CORE_DIST`, `DASHQL_COMPUTE_DIST`, `DASHQL_PROTOBUF_DIST` (absolute after launcher) for resolve.alias to `@ankoh/*`. Uses `NODE_PATH` for the node_modules plugin and `@bokuweb/zstd-wasm`. Sets `base` from mode and Rollup options for cache-busting.
- **Build targets:** `reloc` and `pages` use a custom rule (`_vite_build`) that runs `bazel/vite/vite_sandboxed.cjs` with `VITE_OUT_DIR` and the DASHQL_*_DIST env vars; the rule passes the `vite build` command line and the launcher resolves paths and runs it.

## Local (non-Bazel) Vite dev

From `packages/dashql-app` you can run Vite directly:

```bash
cd packages/dashql-app && pnpm exec vite
# or: npx vite
```

Ensure `@ankoh/dashql-core` and `@ankoh/dashql-compute` are built and linked (e.g. via workspace `link:` in package.json). No `DASHQL_NODE_PATH_OVERLAY` is needed when using the workspace node_modules.

## Files

- `packages/dashql-app/vite.config.ts` — Vite config (base, build output, define, resolve.alias, HMR).
- `packages/dashql-app/index.html` / `oauth.html` — Vite entry HTML (app and oauth_redirect).
- `packages/dashql-app/BUILD.bazel` — loads `//bazel/vite:vite.bzl`; `vite_runner` (js_binary), `vite_dev` (alias), `reloc`, `pages` (custom _vite_build rule).
- `bazel/vite/vite.bzl` — Vite/Vitest macro and _vite_build rule (used by dashql-app).
- `bazel/vite/vite_dev_server.cjs` — Bazel dev server launcher; sets NODE_PATH from runfiles and forwards to `vite/bin/vite.js`.
- `bazel/vite/vite_sandboxed.cjs` — Sandboxed launcher for _vite_build rule; resolves `VITE_OUT_DIR`, discovers npm from runfiles, chdirs to package, runs Vite with argv from the rule (e.g. `vite build`).
- `bazel/vite/vite_bazel_paths.cjs` — Shared path resolution and rollup discovery for both launchers.

## Cache-busting

Production builds use Rollup output options in `vite.config.ts`:

- `entryFileNames`: `static/js/[name].[hash].js`
- `chunkFileNames`: `static/js/[name].[hash].js`
- `assetFileNames`: by type (css, wasm, img, fonts, etc.) with `[hash]` where appropriate.

So every build gets unique filenames for long-term caching.
