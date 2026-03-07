import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname, delimiter, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync, existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** True when running under Bazel with direct @ankoh paths (DASHQL_*_DIST set). */
const inBazelWithDeps = !!(
  process.env.DASHQL_CORE_DIST || process.env.DASHQL_COMPUTE_DIST || process.env.DASHQL_PROTOBUF_DIST
);

/** Resolve bare specifiers from node_modules. Uses NODE_PATH when set (Bazel), else local lookup. */
function bazelNodeModulesPlugin(): { name: string; enforce: 'pre'; resolveId: (id: string) => string | null } | null {
  const nodePath = process.env.NODE_PATH;
  const cwd = process.cwd();
  let npmCandidates = nodePath ? nodePath.split(delimiter) : [];
  if (!npmCandidates.length || inBazelWithDeps) {
    const fallbacks = [resolve(cwd, 'node_modules'), resolve(cwd, '..', 'node_modules'), resolve(cwd, '..', '..', 'node_modules')];
    npmCandidates = [...npmCandidates, ...fallbacks];
  }
  const npmPaths = npmCandidates.filter((p) => p && existsSync(p));
  if (npmPaths.length === 0) return null;
  const req = createRequire(import.meta.url);
  let zstdRoot: string | null = null;
  function getZstdRoot(): string | null {
    if (zstdRoot != null) return zstdRoot;
    try {
      const pkg = req.resolve('@bokuweb/zstd-wasm/package.json', { paths: npmPaths });
      zstdRoot = dirname(pkg);
      return zstdRoot;
    } catch {
      // Fallback: scan NODE_PATH for @bokuweb/zstd-wasm (pnpm/aspect_rules_js layout).
      for (const base of npmPaths) {
        const direct = resolve(base, '@bokuweb', 'zstd-wasm');
        if (existsSync(resolve(direct, 'package.json'))) {
          zstdRoot = direct;
          return zstdRoot;
        }
        try {
          const aspectDir = resolve(base, '.aspect_rules_js');
          if (existsSync(aspectDir)) {
            for (const name of readdirSync(aspectDir)) {
              if (name.includes('zstd-wasm')) {
                const pkgDir = resolve(aspectDir, name, 'node_modules', '@bokuweb', 'zstd-wasm');
                if (existsSync(resolve(pkgDir, 'package.json'))) {
                  zstdRoot = pkgDir;
                  return zstdRoot;
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }
      return null;
    }
  }
  return {
    name: 'bazel-node-modules',
    enforce: 'pre',
    resolveId(id: string) {
      if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return null;
      // Under Bazel, resolve core WASM from DASHQL_CORE_WASM_PATH so it wins over alias.
      const coreWasmId = id.replace(/\?.*$/, '');
      if (inBazelWithDeps && coreWasmId === '@ankoh/dashql-core/dist/dashql_core.wasm') {
        let p = process.env.DASHQL_CORE_WASM_PATH;
        if (p) {
          if (!isAbsolute(p)) {
            const runfiles = process.env.RUNFILES_DIR;
            const main = process.env.RUNFILES_MAIN_REPO || '_main';
            if (runfiles && main) {
              p = resolve(runfiles, main, p);
            } else {
              p = resolve(process.cwd(), p);
            }
          }
          if (existsSync(p)) {
            const q = id.includes('?') ? id.slice(id.indexOf('?')) : '';
            return q ? p + '?' + q.slice(1) : p;
          }
        }
      }
      // Let resolve.alias handle other @ankoh/* when DASHQL_*_DIST are set (Bazel build).
      if (inBazelWithDeps && (id.startsWith('@ankoh/dashql-protobuf') || id === '@ankoh/dashql-core' || id.startsWith('@ankoh/dashql-compute'))) return null;
      // Resolve @bokuweb/zstd-wasm subpaths to files so we bypass package exports.
      if (id.startsWith('@bokuweb/zstd-wasm/')) {
        const root = getZstdRoot();
        if (root) {
          const raw = id.replace(/\?.*$/, '');
          const sub = id.slice('@bokuweb/zstd-wasm/'.length).replace(/\?.*$/, '');
          const file = resolve(root, sub);
          if (existsSync(file)) {
            // Keep ?url so Vite treats .wasm as URL asset, not ESM wasm.
            const query = id.includes('?') ? id.slice(id.indexOf('?')) : '';
            return query ? file + '?' + query.slice(1) : file;
          }
        }
      }
      try {
        return req.resolve(id, { paths: npmPaths });
      } catch {
        return null;
      }
    },
  };
}

/** Version and gitCommit for define: from env (Bazel), app package.json, or root package.json. */
function loadVersionGitCommit(): { version: string; gitCommit: string } {
  if (process.env.DASHQL_VERSION !== undefined && process.env.DASHQL_GIT_COMMIT !== undefined) {
    return {
      version: process.env.DASHQL_VERSION,
      gitCommit: process.env.DASHQL_GIT_COMMIT,
    };
  }
  const appPkgPath = resolve(__dirname, 'package.json');
  if (existsSync(appPkgPath)) {
    try {
      const p = JSON.parse(readFileSync(appPkgPath, 'utf8')) as { version?: string; gitCommit?: string };
      return { version: p.version ?? '', gitCommit: p.gitCommit ?? '' };
    } catch {
      // fall through to root
    }
  }
  const rootPkgPath = resolve(__dirname, '..', '..', 'package.json');
  if (existsSync(rootPkgPath)) {
    try {
      const p = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version?: string; gitCommit?: string };
      return { version: p.version ?? '', gitCommit: p.gitCommit ?? '' };
    } catch {
      // fall through
    }
  }
  return { version: '', gitCommit: '' };
}
const pkg = loadVersionGitCommit();

export default defineConfig(({ mode, command }) => {

  const isReloc = mode === 'reloc';
  const base = isReloc ? './' : '/';

  // Under Bazel, stay in package dir (cwd) so HTML/src paths resolve; node_modules at runfiles root.
  const root = inBazelWithDeps ? process.cwd() : __dirname;

  return {
    root,
    base,
    publicDir: 'static',
    build: {
      // Under Bazel, rule passes VITE_OUT_DIR (path to declared output) so Vite writes to an allowed directory.
      outDir: process.env.VITE_OUT_DIR
        ? (isAbsolute(process.env.VITE_OUT_DIR) ? process.env.VITE_OUT_DIR : resolve(root, process.env.VITE_OUT_DIR))
        : 'dist',
      emptyOutDir: !inBazelWithDeps, // Under Bazel, output dir is managed by the rule.
      sourcemap: false,
      target: 'es2020',
      rollupOptions: {
        input: {
          app: resolve(root, 'index.html'),
          oauth_redirect: resolve(root, 'oauth.html'),
        },
        external: (id) => {
          if (typeof id !== 'string') return false;
          if (id.startsWith('node:')) return true;
          if (id.startsWith('@tauri-apps/')) return true; // Native-only; not resolved in web build.
          const builtins = new Set(['stream', 'buffer', 'fs', 'path', 'util', 'os', 'crypto', 'url', 'assert', 'events', 'module', 'process']);
          return builtins.has(id);
        },
        output: {
          entryFileNames: 'static/js/[name].[hash].js',
          chunkFileNames: 'static/js/[name].[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || '';
            if (/\.(css)$/.test(name)) return 'static/css/[name].[hash][extname]';
            if (/\.(wasm|wasm\.map)$/.test(name)) return 'static/wasm/[name][extname]';
            if (/\.(sql)$/i.test(name)) return 'static/scripts/[name].[hash][extname]';
            if (/\.(png|jpe?g|gif|ico|svg)$/i.test(name)) return 'static/img/[name].[hash][extname]';
            if (/\.(ttf)$/i.test(name)) return 'static/fonts/[name].[hash][extname]';
            return 'static/assets/[name].[hash][extname]';
          },
        },
      },
      minify: mode !== 'development' ? 'esbuild' : false,
      cssCodeSplit: true,
      modulePreload: { polyfill: false },
    },
    define: {
      'process.env.DASHQL_BUILD_MODE': JSON.stringify(command === 'serve' ? 'development' : 'production'),
      'process.env.DASHQL_VERSION': JSON.stringify(pkg.version),
      'process.env.DASHQL_GIT_COMMIT': JSON.stringify(pkg.gitCommit || ''),
      'process.env.DASHQL_APP_URL': JSON.stringify(process.env.DASHQL_APP_URL || 'https://dashql.app'),
      'process.env.DASHQL_LOG_LEVEL': JSON.stringify(process.env.DASHQL_LOG_LEVEL || (command === 'serve' ? 'debug' : 'info')),
      'process.env.DASHQL_RELATIVE_IMPORTS': JSON.stringify(isReloc),
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.jsx', '.css', '.wasm'],
      alias: (() => {
        type AliasEntry = { find: string; replacement: string };
        const aliasList: AliasEntry[] = [];
        const alias: Record<string, string> = {};
        // Resolve runfiles-relative DASHQL_*_DIST to absolute when needed (cwd may be package dir).
        const resolveDist = (p: string | undefined): string | undefined => {
          if (!p) return p;
          if (isAbsolute(p)) return p;
          // Bazel run_shell: cwd is execroot; paths like bazel-out/... are relative to execroot.
          const bases = [
            process.cwd(),
            resolve(process.cwd(), '..'),
            resolve(process.cwd(), '..', '..'),
            resolve(__dirname, '..', '..'),
          ];
          for (const base of bases) {
            const abs = resolve(base, p);
            if (existsSync(abs)) return abs;
          }
          return p;
        };
        const coreDist = resolveDist(process.env.DASHQL_CORE_DIST);
        const coreWasmPath =
          resolveDist(process.env.DASHQL_CORE_WASM_PATH) ||
          (coreDist ? resolve(coreDist, '..', '..', 'dashql_core_opt.wasm') : undefined) ||
          (coreDist ? resolve(coreDist, '..', '..', 'dashql_core.wasm') : undefined);
        const computeDist = resolveDist(process.env.DASHQL_COMPUTE_DIST);
        const protobufDist = resolveDist(process.env.DASHQL_PROTOBUF_DIST);
        const coreRoot = resolve(__dirname, '..', 'dashql-core', 'api');
        if (coreDist && existsSync(coreDist)) {
          // Array form with wasm first so it matches before the shorter @ankoh/dashql-core/dist.
          if (coreWasmPath) {
            aliasList.push({ find: '@ankoh/dashql-core/dist/dashql_core.wasm', replacement: coreWasmPath });
          }
          aliasList.push({ find: '@ankoh/dashql-core/dist', replacement: coreDist });
          aliasList.push({ find: '@ankoh/dashql-core', replacement: resolve(coreDist, 'src/index.js') });
        } else if (existsSync(coreRoot)) {
          const distOpt = resolve(coreRoot, 'dist_opt');
          const distDir = existsSync(resolve(distOpt, 'src/index.js')) ? distOpt : resolve(coreRoot, 'dist');
          if (existsSync(distDir)) {
            alias['@ankoh/dashql-core/dist'] = distDir;
            alias['@ankoh/dashql-core'] = existsSync(resolve(distDir, 'src/index.js'))
              ? resolve(distDir, 'src/index.js')
              : resolve(distDir, 'dashql.module.js');
          }
        }
        if (computeDist && existsSync(computeDist)) {
          alias['@ankoh/dashql-compute'] = resolve(computeDist, 'dashql_compute.js');
          alias['@ankoh/dashql-compute/dashql_compute_bg.wasm'] = resolve(computeDist, 'dashql_compute_bg.wasm');
        }
        if (protobufDist && existsSync(protobufDist)) {
          alias['@ankoh/dashql-protobuf'] = protobufDist;
        }
        // Resolve @bokuweb/zstd-wasm from NODE_PATH; alias subpaths so Vite bypasses package exports.
        const nodePath = process.env.NODE_PATH;
        if (nodePath) {
          try {
            const req = createRequire(import.meta.url);
            const zstdPkg = req.resolve('@bokuweb/zstd-wasm/package.json', {
              paths: nodePath.split(delimiter).filter(Boolean),
            });
            const zstdRoot = dirname(zstdPkg);
            alias['@bokuweb/zstd-wasm'] = zstdRoot;
            alias['@bokuweb/zstd-wasm/dist/esm/index.web.js'] = resolve(zstdRoot, 'dist/esm/index.web.js');
            alias['@bokuweb/zstd-wasm/dist/web/zstd.wasm'] = resolve(zstdRoot, 'dist/web/zstd.wasm');
          } catch {
            // not in NODE_PATH
          }
        }
        if (aliasList.length > 0) {
          return [...aliasList, ...Object.entries(alias).map(([find, replacement]) => ({ find, replacement }))];
        }
        return alias;
      })(),
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: command === 'serve' ? '[local]_[hash:base64:5]' : '[hash:base64]',
      },
    },
    server: {
      port: 9002,
      strictPort: false,
      hmr: true,
      cors: true,
      fs: { allow: ['..'] },
    },
    plugins: [bazelNodeModulesPlugin(), react()].filter(Boolean),
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom'],
    },
    worker: {
      format: 'es',
    },
  };
});
