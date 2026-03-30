import react from "@vitejs/plugin-react";
import { checker } from "vite-plugin-checker";
import * as vite from "vite";
import * as path from "node:path";
import * as nodeFs from "node:fs";

const DASHQL_VERSION = "__DASHQL_VERSION__";
const DASHQL_COMMIT = "__DASHQL_COMMIT__";

export default vite.defineConfig(({ mode, command }) => {
    const isReloc = mode === 'reloc';
    const isTest = mode === 'test';
    const base = isReloc ? './' : '/';
    const rootDir = process.cwd();
    const FLATBUF_PATH = path.resolve(rootDir, "__FLATBUF_PATH__");
    const PROTOBUF_PATH = path.resolve(rootDir, "__PROTOBUF_PATH__");
    const COMPUTE_PATH = path.resolve(rootDir, "__COMPUTE_PATH__");
    const CORE_JS_PATH = path.resolve(rootDir, "__CORE_JS_PATH__");
    const CORE_WASM_PATH = path.resolve(rootDir, "__CORE_WASM_PATH__");
    const ZSTD_WASM_PATH = path.resolve(rootDir, "__ZSTD_WASM_PATH__");
    const WEBDB_JS_PATH = path.resolve(rootDir, "__WEBDB_JS_PATH__");
    const WEBDB_WASM_PATH = path.resolve(rootDir, "__WEBDB_WASM_PATH__");
    const SVG_SYMBOLS_PATH = path.resolve(rootDir, "__SVG_SYMBOLS_PATH__");

    return {
        plugins: [
            react(),
            // In the Bazel sandbox, HTML entry files are symlinks to the execroot. Rolldown
            // follows them during input resolution, causing vite:build-html to compute the
            // output fileName as a deep ../../execroot/... traversal, which Rolldown rejects.
            // Intercept absolute HTML resolution and return the id unchanged to preserve the
            // sandbox symlink path; path.relative(config.root, sandboxHtmlPath) = "oauth.html".
            ...(!isTest ? [{
                name: 'bazel-preserve-html-entry-symlinks',
                enforce: 'pre' as const,
                resolveId(id: string): string | undefined {
                    if (id.endsWith('.html') && path.isAbsolute(id)) {
                        return id;
                    }
                },
            }] : []),
            ...(isTest ? [] : [checker({
                enableBuild: false,
                typescript: true,
            })]),
        ],
        root: rootDir,
        base,
        build: {
            target: 'es2020',
            rolldownOptions: {
                input: {
                    app: path.resolve(rootDir, "index.html"),
                    oauth_redirect: path.resolve(rootDir, "oauth.html"),
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
                        const name = (assetInfo?.names.length > 0 ? assetInfo.names[0] : '');
                        const ext = (assetInfo as { extname?: string }).extname ?? '';
                        if (/\.(css)$/.test(name) || ext === '.css') return 'static/css/[name].[hash][extname]';
                        if (/\.(wasm|wasm\.map)$/.test(name) || ext === '.wasm') return 'static/wasm/[name].[hash][extname]';
                        if (/\.(js|mjs)$/i.test(name) || ext === '.js' || ext === '.mjs') return 'static/js/[name].[hash][extname]';
                        if (/\.(sql)$/i.test(name) || /\.sql$/i.test(ext)) return 'static/scripts/[name].[hash][extname]';
                        if (/\.(png|jpe?g|gif|ico|svg)$/i.test(name)) return 'static/img/[name].[hash][extname]';
                        if (/\.(ttf)$/i.test(name) || ext === '.ttf') return 'static/fonts/[name].[hash][extname]';
                        return 'static/assets/[name].[hash][extname]';
                    },
                },
            },
            minify: mode !== 'development' ? 'oxc' : false,
            cssCodeSplit: true,
            modulePreload: { polyfill: false },
        },
        define: {
            'process.env.DASHQL_BUILD_MODE': JSON.stringify(command === 'serve' ? 'development' : 'production'),
            'process.env.DASHQL_VERSION': JSON.stringify(DASHQL_VERSION),
            'process.env.DASHQL_GIT_COMMIT': JSON.stringify(DASHQL_COMMIT),
            'process.env.DASHQL_APP_URL': JSON.stringify(process.env.DASHQL_APP_URL || 'https://dashql.app'),
            'process.env.DASHQL_LOG_LEVEL': JSON.stringify(process.env.DASHQL_LOG_LEVEL || (command === 'serve' ? 'debug' : 'info')),
            'process.env.DASHQL_RELATIVE_IMPORTS': JSON.stringify(isReloc),
        },
        resolve: {
            // In the Bazel sandbox, source files are symlinks pointing to the execroot.
            // Rolldown follows symlinks during module resolution, converting sandbox paths
            // to /@fs/[execroot-path] URLs that Vite 8 then blocks via server.fs.allow.
            // Preserving symlinks in test mode keeps paths as sandbox paths (under rootDir).
            ...(isTest ? { preserveSymlinks: true } : {}),
            alias: [
                { find: /@ankoh\/dashql-flatbuf/, replacement: FLATBUF_PATH },
                { find: /@ankoh\/dashql-protobuf/, replacement: PROTOBUF_PATH },
                { find: /^@ankoh\/dashql-compute$/, replacement: COMPUTE_PATH },
                {
                    find: /^@ankoh\/dashql-compute\/dashql_compute_bg.wasm(\?.*)?$/,
                    replacement: COMPUTE_PATH + "/dashql_compute_bg.wasm" + "$1",
                },
                {
                    find: /^@ankoh\/dashql-core-js(\?.*)?$/,
                    replacement: CORE_JS_PATH + "$1",
                },
                {
                    find: /^@ankoh\/dashql-core-wasm(\?.*)?$/,
                    replacement: CORE_WASM_PATH + "$1",
                },
                {
                    find: /^@bokuweb\/zstd-wasm\/dist\/web\/zstd.wasm(\?.*)?$/,
                    replacement: ZSTD_WASM_PATH + "$1",
                },
                {
                    find: /^@dashql\/webdb-wasm(\?.*)?$/,
                    replacement: WEBDB_WASM_PATH + "$1",
                },
                {
                    find: /^@dashql\/webdb-wasm-js(\?.*)?$/,
                    replacement: WEBDB_JS_PATH + "$1",
                },
                { find: /@ankoh\/dashql-svg-symbols/, replacement: SVG_SYMBOLS_PATH },
                // Test-only mocks for asset imports (replacing Jest moduleNameMapper)
                ...(isTest ? [
                    {
                        find: /^.+\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|html|wasm)$/,
                        replacement: path.resolve(rootDir, "utils/file_mock.ts")
                    },
                    {
                        find: /^.+\.(css|styl|less|sass|scss)$/,
                        replacement: path.resolve(rootDir, "utils/style_mock.ts")
                    },
                ] : []),
            ],
        },
        css: {
            modules: {
                localsConvention: 'camelCase',
                generateScopedName: command === 'serve' ? '[local]_[hash:base64:5]' : '[hash:base64]',
            },
        },
        server: {
            port: 9002,
            strictPort: true,
            hmr: true,
            cors: true,
            fs: {
                // Allow-list paths into the sandbox (resolves symlinks).
                allow: [
                    '.', // Current directory
                ].concat((() => {
                    const paths = [
                        FLATBUF_PATH,
                        PROTOBUF_PATH,
                        COMPUTE_PATH,
                        path.dirname(CORE_JS_PATH),
                        path.dirname(CORE_WASM_PATH),
                        path.dirname(ZSTD_WASM_PATH),
                        path.dirname(WEBDB_JS_PATH),
                        path.dirname(WEBDB_WASM_PATH),
                        path.dirname(SVG_SYMBOLS_PATH),
                    ].map(p => { try { return nodeFs.realpathSync(p); } catch { return p; } });
                    // In the Bazel processwrapper sandbox, source files are symlinks pointing
                    // into the execroot. Vite 8 strictly enforces server.fs.allow, so we must
                    // add the real execroot app root. Follow vitest_setup.ts (dirname x2) to
                    // find it: utils/vitest_setup.ts -> packages/dashql-app/ in bazel-out.
                    try {
                        const real = nodeFs.realpathSync(path.resolve(rootDir, "utils/vitest_setup.ts"));
                        paths.push(path.dirname(path.dirname(real)));
                    } catch { /* not in Bazel sandbox */ }
                    return paths;
                })()),
            },
        },
        optimizeDeps: {
            include: ['react', 'react-dom', 'react-router-dom'],
        },
        worker: {
            format: 'es',
            rolldownOptions: {
                output: {
                    entryFileNames: 'static/js/[name].[hash].js',
                    chunkFileNames: 'static/js/[name].[hash].js',
                    assetFileNames: (assetInfo: vite.Rollup.PreRenderedAsset) => {
                        const name = (assetInfo.names?.length > 0 ? assetInfo.names[0] : '') || '';
                        const ext = (assetInfo as { extname?: string }).extname ?? '';
                        if (/\.(wasm|wasm\.map)$/.test(name) || ext === '.wasm') return 'static/wasm/[name].[hash][extname]';
                        if (/\.(js|mjs)$/i.test(name) || ext === '.js' || ext === '.mjs') return 'static/js/[name].[hash][extname]';
                        return 'static/assets/[name].[hash][extname]';
                    },
                },
            },
        },
        test: {
            globals: true,
            environment: 'jsdom',
            pool: 'threads',
            isolate: false,
            setupFiles: [
                path.resolve(rootDir, "utils/vitest_setup.ts")
            ],
            include: ["src/**/*.test.{ts,tsx}"],
            reporter: 'default',
            coverage: { reporter: [], provider: undefined, enabled: false },
        },
    };
});
