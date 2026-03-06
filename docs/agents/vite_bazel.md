# Vite + rules_js (Bazel) migration

This document describes the Vite-based app build that runs under Bazel using rules_js. It provides hot-module reloading (HMR) for development and cache-busted production builds without NODE_PATH patches in the rules.

## Overview

- **Dev (HMR):** `bazel run //packages/dashql-app:vite_dev` — runs Vite dev server with HMR. No merged tree: BUILD passes `DASHQL_ANKOH_OVERLAY` and `DASHQL_NPM_NODE_MODULES`; `run_vite.cjs` sets `NODE_PATH = overlay/node_modules + npm` so `@ankoh/*` and npm packages resolve.
- **Build (reloc):** `bazel build //packages/dashql-app:vite_reloc` — output in `dist/` with content-hashed filenames (`[name].[hash].js`, etc.).
- **Build (pages):** `bazel build //packages/dashql-app:vite_pages` — same with `base: '/'` for path-based routing.

## Prerequisites

1. **Adding or changing npm packages**  
   pnpm is the primary package manager. Add the package to the root `package.json` or to `packages/dashql-app/package.json` (or another workspace), then run:

   ```bash
   pnpm install
   ```

   Then run `bazel build //packages/dashql-app:vite_reloc` (or your target). The `npm_translate_lock` extension reads `package.json` and `pnpm-lock.yaml`; when those inputs change, the extension re-runs and the npm repo is updated. You should not need `bazel clean` or `--expunge` when adding packages. If a new package is still not found, run `bazel clean` and build once; use `bazel clean --expunge` only if that fails.

2. **Core and Compute built**  
   Build `@ankoh/dashql-core` and `@ankoh/dashql-compute` before running the app (e.g. `make core_js_o2` and `make compute_wasm_o3`). The overlay (`//packages/dashql-app:ankoh_overlay`) provides `node_modules/@ankoh/dashql-core` and `@ankoh/dashql-compute`; the launcher uses NODE_PATH = overlay/node_modules + `//:node_modules` (no copy merge).

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
   bazel build --config=vite //packages/dashql-app:vite_reloc
   ```
   This sets `--experimental_writable_outputs`.

2. **Run the build locally** (no experimental flag):

   ```bash
   bazel build --config=vite_local //packages/dashql-app:vite_reloc
   ```
   This sets `--spawn_strategy=local` so the action runs in a context where the output directory is writable.

As a last resort, try `bazel clean` and rebuild once.

## How it works

- **Paths from Bazel:** Build targets set `env = { "DASHQL_ANKOH_OVERLAY": "$(rootpath :ankoh_overlay)" }`. Overlay path comes from Bazel; npm is discovered from runfiles in the launcher when overlay is set.
- **Launcher (`run_vite.cjs`):** When `DASHQL_ANKOH_OVERLAY` is set, resolves it (runfiles via `__dirname` first), discovers npm from runfiles, sets `NODE_PATH` and `DASHQL_NODE_PATH_OVERLAY`. Vite bin is resolved from the npm tree.
- **Vite config (`vite.config.ts`):** Uses `DASHQL_NODE_PATH_OVERLAY` for resolve.alias to `@ankoh/*`. Uses `NODE_PATH` for the node_modules plugin and `@bokuweb/zstd-wasm`. Sets `base` from mode and Rollup options for cache-busting.
- **Build targets:** `vite_reloc` and `vite_pages` use a custom rule (`_vite_build`) that runs `run_vite_build.cjs` with `VITE_OUT_DIR` set to the declared output path, so Vite writes to an allowed directory. Overlay and npm are discovered from runfiles in the launcher.

## Local (non-Bazel) Vite dev

From `packages/dashql-app` you can run Vite directly:

```bash
cd packages/dashql-app && pnpm exec vite
# or: npx vite
```

Ensure `@ankoh/dashql-core` and `@ankoh/dashql-compute` are built and linked (e.g. via workspace `link:` in package.json). No `DASHQL_NODE_PATH_OVERLAY` is needed when using the workspace node_modules.

## Files

- `packages/dashql-app/vite.config.ts` — Vite config (base, build output, define, resolve.alias, HMR).
- `packages/dashql-app/run_vite.cjs` — Bazel launcher; sets NODE_PATH from runfiles and forwards to `vite/bin/vite.js`.
- `packages/dashql-app/index.html` / `oauth.html` — Vite entry HTML (app and oauth_redirect).
- `packages/dashql-app/BUILD.bazel` — `vite_runner` (js_binary), `vite_dev` (alias), `vite_reloc`, `vite_pages` (custom _vite_build rule).
- `packages/dashql-app/run_vite_build.cjs` — Build launcher; resolves `VITE_OUT_DIR`, discovers overlay/npm from runfiles, runs `vite build`.

## Cache-busting

Production builds use Rollup output options in `vite.config.ts`:

- `entryFileNames`: `static/js/[name].[hash].js`
- `chunkFileNames`: `static/js/[name].[hash].js`
- `assetFileNames`: by type (css, wasm, img, fonts, etc.) with `[hash]` where appropriate.

So every build gets unique filenames for long-term caching.
