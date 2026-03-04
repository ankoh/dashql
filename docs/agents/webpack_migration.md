# Webpack + aspect_rules_webpack migration (Bazel)

This document summarizes findings from migrating the DashQL PWA build to `aspect_rules_webpack`. It is intended for agents and maintainers.

## Current setup (no patches, single node_modules at root)

- **node_modules at root:** Root `BUILD.bazel` has `npm_link_all_packages(name = "npm_node_modules")` and a `copy_to_directory` that merges `npm_node_modules` (under `node_modules/`) with `//packages/dashql-app:ankoh_overlay` into a single `//:node_modules`. So npm packages and `@ankoh/dashql-core` / `@ankoh/dashql-compute` (Bazel dists) live in one tree.
- **Build:** `webpack_bundle` with `node_modules = "//:node_modules"`, `chdir = "."`, and `env.NODE_PATH = "$(rootpath //:node_modules)"` so both the config and app code resolve from the merged runfiles node_modules. No launcher patches.
- **Webpack config:** Shared `webpack.common.ts` + `wasm_map.ts`; `webpack.reloc.ts` and `webpack.pages.ts` are bundled with esbuild into a single `.cjs` per variant so plugins are inlined and the config has no runtime `require()` of npm plugins (except webpack, which is external).
- **References:** For targets that need individual npm package labels (e.g. esbuild config deps, jest data), use `//:npm_node_modules/...`. For `node_modules` used by rules (webpack, jest), use `//:node_modules` (the merged directory).

## The problem (historical: when using separate overlay + launcher patch) `bazel/patches/aspect_rules_js_node_path.patch` patches `js_binary.sh.tpl` to set `NODE_PATH` to runfiles `_main/bazel/npm/node_modules` first, then the rule’s expanded overlay, so that the **config file’s** `require('copy-webpack-plugin')` etc. can resolve from runfiles. In practice the process that loads the config often does not see this NODE_PATH (see “The problem” below).

## The problem

When the webpack action runs:

1. The **config file** lives under the **fastbuild** output tree:  
   `execroot/_main/bazel-out/darwin_arm64-fastbuild/bin/packages/dashql-app/reloc_webpack.config.cjs`.
2. **webpack-cli** is loaded from the **opt-exec** runfiles tree:  
   `.../darwin_arm64-opt-exec-ST-.../bin/.../_reloc_webpack_binary.runfiles/_main/bazel/npm/node_modules/.../webpack-cli`.
3. The **require stack** also shows **import-local** and **webpack** from the **fastbuild** tree:  
   `.../darwin_arm64-fastbuild/bin/bazel/npm/node_modules/.../import-local`, `.../webpack/bin/webpack.js`.

So two different trees are involved: the **tool** (webpack binary) runs from **opt-exec runfiles**, but the **entry** (webpack.js) or resolution can end up in **fastbuild**, so the process that loads the config may not see the launcher’s `NODE_PATH` (runfiles node_modules). Node then resolves `require('copy-webpack-plugin')` from the config’s directory and its ancestors (fastbuild tree) and never finds the package.

## What we tried

### 1. Launcher patch (NODE_PATH from runfiles)

- **Patch:** In `js_binary.sh.tpl`, before “Run the main program”, set `NODE_PATH` to  
  `runfiles/_main/bazel/npm/node_modules` and, if the rule already set `NODE_PATH`, prepend that and expand to absolute runfiles paths.
- **Fallback:** If `JS_BINARY__RUNFILES` is unset, derive runfiles from the script path:  
  `script_path="${BASH_SOURCE[0]:-$0}"`, `script_dir="$(cd "$(dirname "$script_path")" && pwd)"`, then use `"${script_dir}.runfiles"` if it exists.
- **Result:** Patch applies and runs, but the process that actually loads the config still fails to resolve `copy-webpack-plugin`. So either (a) that process is not the direct child of the patched launcher (e.g. import-local runs from fastbuild), or (b) `JS_BINARY__RUNFILES` / script-dir fallback is empty in the webpack action so `NODE_PATH` is never set.

### 2. Rule `env.NODE_PATH` with npm node_modules

- **Idea:** Add `//bazel/npm:node_modules` to `data` and set  
  `NODE_PATH = "$(rootpath //bazel/npm:node_modules):$(rootpath :ankoh_overlay)"`.
- **Result:** `//bazel/npm:node_modules` expands to many files; Bazel reports “expands to more than one file, please use $(locations ...)”. So we cannot pass a single directory path for `NODE_PATH` from the rule.

### 3. Config-side resolution (`requireFromNodePath`)

- **Idea:** In the webpack config, resolve plugins via `require.resolve(id, { paths: process.env.NODE_PATH.split(...) })` so we explicitly use NODE_PATH instead of Node’s default “local node_modules first” behavior.
- **Result:** When `NODE_PATH` is unset (as in the failing run), resolution still fails. So the config runs in a context where launcher `NODE_PATH` is not visible.

### 4. Config fallbacks when NODE_PATH is unset

- **Fallback A:** Walk up from `module.parent.filename` (webpack-cli) and use the first directory that contains the requested package or `.aspect_rules_js` as the root node_modules.
- **Fallback B:** From `process.cwd()` (e.g. `execroot/_main/packages/dashql-app`), try `../bazel-out`, `../../bazel-out`, `../../../bazel-out`, then look for `darwin_arm64-opt-exec-*` (or `linux-opt-exec-*`) and build the runfiles path  
  `bazel-out/<config>/bin/packages/dashql-app/_reloc_webpack_binary_/_reloc_webpack_binary.runfiles/_main/bazel/npm/node_modules`.
- **Result:** Still `Cannot find module 'copy-webpack-plugin'`. So either (a) `module.parent` is not set as expected when the config is loaded, or (b) cwd / filesystem layout in the action doesn’t match these assumptions (e.g. runfiles not visible from the process that loads the config).

### 5. Disable import-local

- **Idea:** Set `DISABLE_IMPORT_LOCAL=1` (or similar) so webpack-cli doesn’t prefer a “local” webpack from the fastbuild tree.
- **Result:** No change; require stack still shows import-local and fastbuild paths. webpack-cli (or our version) doesn’t honor that env var.

## Why the config can’t see runfiles node_modules

- **use_execroot_entry_point:** rules_webpack docs say `use_execroot_entry_point` (default True) uses the entry script from the **execroot output tree** instead of runfiles to avoid “conflicting runfiles node_modules” for tools like Next.js/React. So the **entry** can be in the fastbuild (or execroot) tree; that process may not inherit the launcher’s `NODE_PATH` or may resolve from a different tree.
- **chdir:** The rule sets `chdir = "packages/dashql-app"`, so the action’s cwd is the package dir. The **config file** path is still under `bazel-out/.../packages/dashql-app/`, so Node’s resolution for `require('copy-webpack-plugin')` walks up from that path; if there is **any** `node_modules` on that path (e.g. in fastbuild output), Node looks there first and never uses `NODE_PATH`.
- **Two trees:** Tool runfiles (opt-exec) vs. config/output (fastbuild) mean the process loading the config may not have the runfiles path on `NODE_PATH` or in its resolution chain.

## Why is “config as build output” so complicated?

We’re doing two things: (1) using `rules_webpack` and (2) passing a **config that is the output of a build step** (TS → CJS) and that **require()s npm packages** (copy-webpack-plugin, html-webpack-plugin, etc.). That combination is not the common case.

- **How rules_webpack is designed**
  - The **webpack binary** is a `js_binary` whose `data` is only `node_modules/webpack` and `node_modules/webpack-cli` (see `webpack_binary.bzl`). So the **tool’s runfiles** do not include the rest of `node_modules` (e.g. copy-webpack-plugin).
  - The **user’s `webpack_config`** is just a file path. The rule does not add “config dependencies” or the full `node_modules` to the action. So when Node loads the config and runs `require('copy-webpack-plugin')`, there is no directory on the resolution path that contains that package unless we set `NODE_PATH` (or bundle the config).
  - The **generated** base config (from `webpack.config.js.tmpl`) uses only Node builtins (no `require()` of npm packages). So the rule’s own config is dependency-free; the problem only appears when the **user’s** config has `require()` of plugins.

- **So the only problem we’re solving is:** use rules_webpack and pass it a config that (a) is the output of a bundler/compiler and (b) at runtime does `require('copy-webpack-plugin')` etc. That’s why it’s complicated: the rule never stages “config’s node_modules” for the config file.

## Isn’t this what every larger project would do?

**No.** Most projects don’t need “config as build output” plus “config that require()s plugins” at the same time.

- **What rules_webpack assumes / what others do**
  - **Generated config only:** Many setups use only the rule’s generated base config (entry, mode, devtool). That config has no `require()` of npm packages, so no resolution issue.
  - **Plain JS config in source:** If they add a custom config, it’s often a **source** `webpack.config.js` that only uses `path` and similar builtins, and doesn’t `require()` plugins. Again, no resolution issue.
  - **rules_nodejs style:** The old rules_nodejs `react_webpack` example passes `data = [..., "@npm//:node_modules"]`, so the **entire** node_modules is in the action. The config (a source file) and node_modules are then both in the runfiles, so `require('copy-webpack-plugin')` resolves. **aspect_rules_webpack does not do this:** it only gives the webpack **binary** webpack + webpack-cli; it never adds the full node_modules to the action for the config.
  - **Bundle the config:** If the config is **bundled** (e.g. with esbuild) so that copy-webpack-plugin etc. are inlined, the config file has no top-level `require()` of those packages. Then the launcher’s `NODE_PATH` is only needed for app resolution (e.g. `@ankoh/*`), not for the config. This is the main alternative that avoids fighting the rule’s execution model.

So “config that is build output and that require()s plugins” is the uncommon case; the rule doesn’t support it out of the box, and most projects either use a minimal config, put the whole node_modules in the action (rules_nodejs style), or bundle the config.

## Research: how others do it / why this is a standard requirement

**Rule source (webpack_bundle.bzl):**

- Inputs to the webpack action are: `copy_files_to_bin_actions(ctx, inputs)` (srcs, deps, entry_points, configs) plus `webpack_runfiles` (when `use_execroot_entry_point`, runfiles are hoisted to execroot). So **srcs are copied to the target’s bin dir** preserving workspace-relative path.
- `chdir` is passed as `JS_BINARY__CHDIR`; the doc says it’s for “buggy resolvers which assume node_modules is in a **parent of the working directory**”. So the rule expects that with the right `chdir`, `node_modules` is visible as a parent of `cwd`. That only works if the **same** `node_modules` passed to the rule is laid out at execroot (e.g. `execroot/node_modules`). The rule does **not** copy that `node_modules` into the execroot; it’s in the webpack binary’s runfiles. So for “parent of cwd” to see it, you’d need either a single-package repo with `node_modules` at root and that tree present in the action, or the rule would have to symlink/copy `node_modules` under the chdir tree (it doesn’t).
- **E2E:** rules_webpack has e2e (smoke, loaders, loaders_jslib, worker). They use the same rule; the standard pattern is `node_modules` = npm link tree at repo root, and **app resolution** relies on that tree being available. So “imports” (app deps) are a standard requirement; the rule assumes the **node_modules** you pass in is both (1) the one where webpack/webpack-cli live and (2) the one used for app resolution. So you must pass a tree that contains **all** app deps (npm + any overlay). We can’t pass `//:node_modules_merged` as `node_modules` because the rule expects a label that has a `webpack` subpath (e.g. `//:node_modules/webpack`), which a TreeArtifact from `copy_to_directory` doesn’t provide. So we pass `//:node_modules` (npm link tree) and put the **merged** tree in **srcs** so it’s copied to bin; the copy layout (from aspect_bazel_lib) puts files at workspace-relative path under the **target’s** bin dir. For a root-package TreeArtifact, the tree’s contents can end up under the **bin root** as `node_modules/` (so `.../bin/node_modules` has react, etc.). So we set `resolve.modules` (and optionally `process.env.NODE_PATH` at config load) to that bin root so webpack and Node can resolve app imports.

## What others do (research)

- **Official docs (aspect_rules_webpack):**  
  - `webpack_bundle` requires a single `webpack_config` file and `node_modules` where webpack and webpack-cli are linked; `data` adds runfiles for the **target**, not for the **config’s** `require()` resolution.  
  - `chdir` is documented as a workaround for “buggy resolvers” that assume node_modules is in a parent of the **working directory** (not the script).  
  - No documented way to pass “runfiles node_modules for the config” as NODE_PATH or similar.

- **rules_js (RUNFILES):**  
  - Issue #285: when a `js_binary` was invoked from an `sh_binary`, RUNFILES was not set; fixed in PR #286 by determining the runfiles directory when launched from a shell binary.  
  - So RUNFILES can be missing in some launch paths; our patch’s fallback (script dir + `.runfiles`) is in the same spirit.

- **NODE_PATH in rule `env`:**  
  - The rule’s `env` is applied to the action; the launcher can override or append to `NODE_PATH`. Our patch does that. If the **actual** node process that loads the config is spawned by something that doesn’t inherit the launcher’s environment (e.g. import-local or a different entry), it won’t see it.

- **Bundling the config:**  
  - Bundling the config (e.g. with esbuild) so the output has no runtime `require()` of copy-webpack-plugin etc. is the pattern that avoids this entire class of issues. We tried that earlier (bundle_webpack_config.cjs) but dropped it for “inline only” simplicity; it is the approach that aligns with how rules_webpack is designed (config with no external npm requires).

- **Config next to node_modules:**  
  - Putting the webpack config inside the same package (or a child of) the `node_modules` tree used by the tool would let Node resolve plugins without NODE_PATH. That would require a different repo layout or copying/linking the config into the runfiles node_modules tree; not done in our current setup.

- **resolve.modules / resolveLoader.modules:**  
  - Webpack’s own resolution is separate from Node’s resolution of the **config file**. So `resolve.modules` in the config doesn’t help the initial `require('copy-webpack-plugin')` when the config is loaded.

## Why esbuild doesn't resolve npm deps (and what's missing to wire it)

When we bundle the webpack config with **aspect_rules_esbuild**, we list the plugin packages in `deps` (e.g. `//bazel/npm:node_modules/copy-webpack-plugin`). The rule does put those npm **files** into the action inputs (via `gather_files_from_js_infos(..., include_npm_sources = True)`), so they are present in the sandbox. The problem is **where** they end up and **how** Node (and thus esbuild) resolves `require('copy-webpack-plugin')`.

1. **Node's resolution algorithm**  
   For a bare specifier like `'copy-webpack-plugin'`, Node looks for `node_modules/copy-webpack-plugin` in the directory of the importing file, then walks up parent directories. The importing file in the action is the entry point after `copy_to_bin`, e.g. under `packages/dashql-app/bundles/` relative to the bin dir. So the search path is: `packages/dashql-app/bundles/node_modules`, `packages/dashql-app/node_modules`, `packages/node_modules`, then the execroot. None of these directories are populated with the npm packages in the sandbox.

2. **Where the npm files actually are**  
   The npm package files are staged at their **runfiles/output paths**, e.g. under `bazel/npm/node_modules/...` (or the pnpm-style layout under that). So they exist in the sandbox, but **not** on the parent-directory chain from the entry point. Node's resolution never walks into `bazel/npm/node_modules` from `packages/dashql-app/bundles/`.

3. **What would fix it: NODE_PATH**  
   If the action set `NODE_PATH` to the directory that contains the npm packages (e.g. the path to `bazel/npm/node_modules` in the sandbox), then `require('copy-webpack-plugin')` would be resolved there. **aspect_rules_esbuild** does **not** set `NODE_PATH` for the esbuild action, and the rule has **no `env` attribute** in its public API, so we cannot pass `NODE_PATH` from the BUILD file without patching the rule.

4. **bazel-sandbox plugin**  
   The sandbox plugin only **validates** that resolved paths stay inside the execroot (and remaps paths that escape). It does not help **find** the package; resolution is still done by Node's algorithm. So the issue is not "the plugin blocks resolution" but "the resolution search path never includes the directory where the npm inputs live."

**What's missing to wire it properly in Bazel:**

- **Option A (patch rule):** Add an `env` attribute to the esbuild rule (with `$(location)` / `$(rootpath)` expansion) and set `NODE_PATH = $(rootpath //bazel/npm:node_modules)` (or the appropriate directory that contains `copy-webpack-plugin` etc.) in the BUILD file. Then the esbuild launcher would run with `NODE_PATH` set and Node would resolve the plugins during the bundle.
- **Option B (patch rule):** Have the rule set `NODE_PATH` automatically when `deps` contain npm packages, e.g. to the common `node_modules` path in the sandbox (derived from the first npm dep or from a dedicated `node_modules` attribute).
- **Option C (no patch):** Keep plugins as `external` and rely on the **webpack** step having the plugins on its runfiles/NODE_PATH (e.g. via the webpack_bundle rule and the launcher NODE_PATH patch), which is the current workaround.

So we **can** point the esbuild resolver at the plugins; what's missing is the rule exposing a way to set `NODE_PATH` (or equivalent) for the action.

## Recommendations

1. **Preferred approach: bundle the config**  
   Build a single CJS bundle (e.g. with esbuild) that inlines copy-webpack-plugin, html-webpack-plugin, etc., so the config file has no top-level `require('copy-webpack-plugin')`. Then the launcher’s NODE_PATH is only needed for the app’s resolution (@ankoh/*), not for the config. This matches how rules_webpack is designed (config without external npm requires) and is what avoids the “config as build output + config require()s plugins” problem.

2. **Verify launcher and process tree (if debugging NODE_PATH):**  
   Run the webpack action with `--subcommands` and, if possible, add a one-line debug in the patched launcher (e.g. `echo "NODE_PATH=$NODE_PATH" >&2`) and in the config (e.g. `console.error('NODE_PATH=', process.env.NODE_PATH, 'cwd=', process.cwd(), 'parent=', module && module.parent && module.parent.filename)`) to confirm whether NODE_PATH is set and which process loads the config.

3. **Ask aspect_rules_webpack for a supported pattern (optional):**  
   Open an issue or discussion asking how they intend users to have the **webpack config file** require npm packages (e.g. plugins) when the config lives in the execroot/output tree and the tool uses runfiles + use_execroot_entry_point. Options might be: a dedicated `config_node_modules` attribute, or documenting a NODE_PATH launcher patch and the exact env the config process gets.

4. **Alternative: config in a package that has node_modules:**  
   Move or symlink the webpack config into a package that is already under the runfiles node_modules (or a directory that Node will search). Then the config’s `require('copy-webpack-plugin')` would resolve without NODE_PATH. This may require restructuring how we pass the config to webpack_bundle.

## Runtime debug (resolve.modules)

Set `DASHQL_DEBUG_RESOLVE=1` in `_WEBPACK_ENV` and run the build to see where the merged tree and rule node_modules end up:

- **cwd** is the bin dir (`.../bin`).
- **Packages (react, etc.)** live at `.../bin/node_modules/` (i.e. `.../bin` has `hasReact=true`). So `resolve.modules = [binRoot]` is correct for app resolution.
- **`.../bin/packages/dashql-app/node_modules_merged`** does **not** exist; the merged tree’s contents are under the bin root, not under the package bin dir.
- With **only** `[binRoot]` in `resolve.modules`, app deps resolve but **loader** resolution fails (e.g. `esbuild-loader`), because loaders live in the rule’s pnpm layout under `.../bin/node_modules` and the resolver doesn’t find them with just the bin root.
- Adding **`path.join(binRoot, 'node_modules')`** to `resolve.modules` fixes loader resolution but brings back 218 errors: webpack then resolves `react-dom` from the rule’s node_modules and then fails to resolve `scheduler` from inside that package (resolution from within node_modules uses a different context).

So the conflict is: one path list is needed for app resolution (merged tree under bin root) and another for loader resolution (pnpm layout under bin/node_modules). Next steps could be staging so a single tree satisfies both, or a resolve plugin that tries binRoot first for app requests.

**Option (1) tried — ensure merged tree also provides loaders:** Added a staging target `//:node_modules_webpack` that copies `//:node_modules_merged` so one tree is used for both app and loader resolution. Findings: (1) When copying a TreeArtifact from another `copy_to_directory`, the output layout preserves source labels (e.g. `node_modules_webpack/node_modules_merged/npm_under_node_modules` and `packages`), not a flat `node_modules/`. (2) Pointing `resolve.modules` at the inner path that should contain `node_modules/react` still showed `hasReact=false` at runtime, so the merged content was not where we expected. (3) With only `[binRoot]`, app deps resolve but loader resolution fails (esbuild-loader); the merged tree at `.../bin/node_modules` likely uses pnpm symlinks that don’t survive the copy, so loaders under `.aspect_rules_js/` aren’t found. To make “one node_modules” work, the merged tree would need to either be the single tree at `.../bin/node_modules` (no rule runfiles node_modules there) or use a copy that resolves symlinks so all packages are real directories.

## Relevant files

- `packages/dashql-app/BUILD.bazel` — webpack_bundle, env, data, chdir.
- `packages/dashql-app/bundles/webpack.reloc.ts`, `webpack.pages.ts` — requireFromNodePath and fallbacks.
- `bazel/patches/aspect_rules_js_node_path.patch` — NODE_PATH in js_binary launcher.
- `MODULE.bazel` — archive_override for aspect_rules_js with patches.

## References

- [aspect_rules_webpack rules.md](https://github.com/aspect-build/rules_webpack/blob/main/docs/rules.md) — webpack_bundle params, use_execroot_entry_point, chdir.
- [aspect-build/rules_js issue #285](https://github.com/aspect-build/rules_js/issues/285) — RUNFILES not set when js_binary launched from sh_binary.
- [rules_js js_run_binary](https://github.com/aspect-build/rules_js/blob/main/docs/js_run_binary.md) — env, runfiles.
- Stack Overflow / rules_nodejs: resolving node_modules and chdir with webpack in Bazel (custom package.json location, pointing webpack to a specific node_modules folder).
