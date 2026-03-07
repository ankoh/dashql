import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname, delimiter, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** True when running under Bazel with direct @ankoh paths (DASHQL_*_DIST set). */
const inBazelWithDeps = !!(
  process.env.DASHQL_CORE_DIST || process.env.DASHQL_COMPUTE_DIST || process.env.DASHQL_PROTOBUF_DIST
);

/** Resolve bare specifiers from node_modules. Under Bazel, NODE_PATH is set by the launcher. */
function bazelNodeModulesPlugin(): { name: string; enforce: 'pre'; resolveId: (id: string) => string | null } | null {
  const nodePath = process.env.NODE_PATH;
  if (!nodePath) return null;
  const npmPaths = nodePath.split(delimiter).filter(Boolean);
  if (npmPaths.length === 0) return null;
  const req = createRequire(import.meta.url);
  let zstdRoot: string | null = null;
  function getZstdRoot(): string | null {
    if (zstdRoot != null) return zstdRoot;
    for (const p of npmPaths) {
      const candidate = resolve(p, '@bokuweb', 'zstd-wasm');
      if (existsSync(resolve(candidate, 'package.json'))) {
        zstdRoot = candidate;
        return zstdRoot;
      }
    }
    return null;
  }
  return {
    name: 'bazel-node-modules',
    enforce: 'pre',
    resolveId(id: string) {
      if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return null;
      // Resolve @ankoh/dashql-core-wasm to DASHQL_CORE_WASM_PATH so it never conflicts with api dist.
      const coreWasmId = id.replace(/\?.*$/, '');
      if (inBazelWithDeps && coreWasmId === '@ankoh/dashql-core-wasm') {
        let p = process.env.DASHQL_CORE_WASM_PATH;
        if (p) {
          if (!isAbsolute(p)) p = resolve(process.cwd(), p);
          const q = id.includes('?') ? id.slice(id.indexOf('?')) : '';
          return q ? p + '?' + q.slice(1) : p;
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

/** Version and gitCommit for define: from Bazel env only. */
function loadVersionGitCommit(): { version: string; gitCommit: string } {
  return {
    version: process.env.DASHQL_VERSION ?? '',
    gitCommit: process.env.DASHQL_GIT_COMMIT ?? '',
  };
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
        // Bazel passes runfiles-relative paths; resolve to absolute from cwd (execroot when launcher runs).
        const resolveDist = (p: string | undefined): string | undefined => {
          if (!p) return p;
          return isAbsolute(p) ? p : resolve(process.cwd(), p);
        };
        const coreDist = resolveDist(process.env.DASHQL_CORE_DIST);
        const coreWasmPath = resolveDist(process.env.DASHQL_CORE_WASM_PATH);
        const computeDist = resolveDist(process.env.DASHQL_COMPUTE_DIST);
        const protobufDist = resolveDist(process.env.DASHQL_PROTOBUF_DIST);
        if (coreDist) {
          aliasList.push({ find: '@ankoh/dashql-core/dist', replacement: coreDist });
          aliasList.push({ find: '@ankoh/dashql-core', replacement: coreDist });
          if (coreWasmPath) {
            aliasList.push({ find: '@ankoh/dashql-core-wasm', replacement: coreWasmPath });
          }
        }
        if (computeDist) {
          alias['@ankoh/dashql-compute'] = resolve(computeDist, 'dashql_compute.js');
          alias['@ankoh/dashql-compute/dashql_compute_bg.wasm'] = resolve(computeDist, 'dashql_compute_bg.wasm');
        }
        if (protobufDist) {
          alias['@ankoh/dashql-protobuf'] = protobufDist;
        }
        const nodePathForZstd = process.env.NODE_PATH;
        if (nodePathForZstd) {
          const pathsForZstd = nodePathForZstd.split(delimiter).filter(Boolean);
          let zstdRootDir: string | null = null;
          for (const p of pathsForZstd) {
            const candidate = resolve(p, '@bokuweb', 'zstd-wasm');
            if (existsSync(resolve(candidate, 'package.json'))) {
              zstdRootDir = candidate;
              break;
            }
          }
          if (zstdRootDir) {
            alias['@bokuweb/zstd-wasm'] = zstdRootDir;
            alias['@bokuweb/zstd-wasm/dist/esm/index.web.js'] = resolve(zstdRootDir, 'dist/esm/index.web.js');
            alias['@bokuweb/zstd-wasm/dist/web/zstd.wasm'] = resolve(zstdRootDir, 'dist/web/zstd.wasm');
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
