import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync, existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve bare specifiers from runfiles node_modules when root is package dir (sandbox). */
function bazelNodeModulesPlugin(): { name: string; enforce: 'pre'; resolveId: (id: string) => string | null } | null {
  const viteRoot = process.env.DASHQL_VITE_ROOT;
  const cwd = process.cwd();
  const npmCandidates = viteRoot
    ? [resolve(viteRoot, 'node_modules')]
    : [resolve(cwd, 'node_modules'), resolve(cwd, '..', 'node_modules'), resolve(cwd, '..', '..', 'node_modules')];
  const npm = npmCandidates.find((p) => existsSync(p));
  if (!npm) return null;
  const req = createRequire(import.meta.url);
  return {
    name: 'bazel-node-modules',
    enforce: 'pre',
    resolveId(id: string) {
      if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return null;
      try {
        return req.resolve(id, { paths: [npm] });
      } catch {
        return null;
      }
    },
  };
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
      emptyOutDir: true,
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
        const overlay = process.env.DASHQL_NODE_PATH_OVERLAY;
        if (overlay) {
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
