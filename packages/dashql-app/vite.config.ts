import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname, sep, delimiter, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync, existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve bare specifiers from node_modules. Uses NODE_PATH when set (Bazel), else local lookup. */
function bazelNodeModulesPlugin(): { name: string; enforce: 'pre'; resolveId: (id: string) => string | null } | null {
  const nodePath = process.env.NODE_PATH;
  const cwd = process.cwd();
  const inBazel = !!process.env.DASHQL_NODE_PATH_OVERLAY;
  let npmCandidates = nodePath ? nodePath.split(delimiter) : [];
  if (!npmCandidates.length || inBazel) {
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

/**
 * Resolve DASHQL_NODE_PATH_OVERLAY to an absolute path under Bazel runfiles.
 * rootpath can be "packages/dashql-app/ankoh_overlay" (repo-relative) or "ankoh_overlay" (runfiles-relative).
 * RUNFILES_DIR may be the runfiles root or the package runfiles dir (e.g. .../bin/packages/dashql-app).
 * Try candidates that actually contain overlay content (node_modules/@ankoh) and return the first that exists.
 */
function resolveOverlayDir(overlay: string): string | null {
  if (!overlay || isAbsolute(overlay)) return overlay || null;
  const protobufModule = 'node_modules/@ankoh/dashql-protobuf/dashql-proto.module.js';
  const cwd = process.cwd();
  const runfilesDir = process.env.RUNFILES_DIR;
  const main = process.env.RUNFILES_MAIN_REPO && process.env.RUNFILES_MAIN_REPO !== '' ? process.env.RUNFILES_MAIN_REPO : '_main';
  const candidates: string[] = [];
  if (runfilesDir) {
    candidates.push(
      resolve(runfilesDir, main, overlay),
      resolve(runfilesDir, overlay),
    );
    if (overlay.startsWith('packages/') && runfilesDir.endsWith('packages/dashql-app')) {
      candidates.unshift(resolve(runfilesDir, 'ankoh_overlay'));
    }
  }
  // Runfiles may put overlay next to package (cwd = runfiles/.../packages/dashql-app, overlay = ankoh_overlay sibling).
  candidates.unshift(resolve(cwd, 'ankoh_overlay'));
  for (const p of candidates) {
    if (existsSync(p) && existsSync(resolve(p, protobufModule))) return p;
  }
  return null;
}

/** Find core_src_tree/src/index.js under dir (Bazel overlay layout). */
function findCoreEntry(dir: string): string | null {
  if (!existsSync(dir)) return null;
  try {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, name.name);
      if (name.isDirectory()) {
        const found = findCoreEntry(full);
        if (found) return found;
      } else if (name.name === 'index.js' && full.includes(`core_src_tree${sep}src`)) {
        return full;
      }
    }
  } catch {
    // ignore
  }
  return null;
}


const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
  gitCommit: string;
};

export default defineConfig(({ mode, command }) => {

  const isReloc = mode === 'reloc';
  const base = isReloc ? './' : '/';

  // Under Bazel, stay in package dir (cwd) so HTML/src paths resolve; node_modules is at runfiles root (see alias below).
  const inBazel = !!process.env.DASHQL_NODE_PATH_OVERLAY;
  const root = inBazel ? process.cwd() : __dirname;

  return {
    root,
    base,
    publicDir: 'static',
    build: {
      outDir: 'dist',
      emptyOutDir: !process.env.DASHQL_NODE_PATH_OVERLAY, // Under Bazel, output dir is managed by the rule.
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
        const alias: Record<string, string> = {};
        const overlayRaw = process.env.DASHQL_NODE_PATH_OVERLAY;
        let overlay = overlayRaw ? resolveOverlayDir(overlayRaw) : null;
        if (!overlay && overlayRaw && process.env.RUNFILES_DIR) {
          const runfilesDir = process.env.RUNFILES_DIR;
          const main = process.env.RUNFILES_MAIN_REPO && process.env.RUNFILES_MAIN_REPO !== '' ? process.env.RUNFILES_MAIN_REPO : '_main';
          const fallback = resolve(runfilesDir, main, overlayRaw);
          if (existsSync(fallback)) overlay = fallback;
        }
        if (overlay) {
          // Ensure NODE_PATH includes overlay/node_modules with an absolute path (rule may pass rootpath, which gets resolved against cwd).
          const overlayNodeModules = resolve(overlay, 'node_modules');
          if (existsSync(overlayNodeModules)) {
            const existing = (process.env.NODE_PATH || '').split(delimiter).filter(Boolean);
            process.env.NODE_PATH = [overlayNodeModules, ...existing].join(delimiter);
          }
          const coreDist = resolve(overlay, 'node_modules/@ankoh/dashql-core/dist');
          // Alias to entry file so Vite does not try to read the overlay dir (EISDIR). Bazel puts core at dist/bazel-out/.../core_src_tree/src/index.js.
          alias['@ankoh/dashql-core/dist'] = coreDist;
          const coreEntry = findCoreEntry(coreDist) || resolve(coreDist, 'src/index.js');
          alias['@ankoh/dashql-core'] = coreEntry;
          // Bazel overlay uses dashql-compute_gen_pkg; alias to entry and wasm so worker/resolver don't hit EISDIR.
          const computePkg = resolve(overlay, 'node_modules/@ankoh/dashql-compute_gen_pkg');
          alias['@ankoh/dashql-compute'] = resolve(computePkg, 'dashql_compute.js');
          alias['@ankoh/dashql-compute/dashql_compute_bg.wasm'] = resolve(computePkg, 'dashql_compute_bg.wasm');
          alias['@ankoh/dashql-protobuf'] = resolve(overlay, 'node_modules/@ankoh/dashql-protobuf/dashql-proto.module.js');
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
