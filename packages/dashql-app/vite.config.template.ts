import react from "@vitejs/plugin-react";
import * as vite from "vite";
import * as path from "node:path";

const DASHQL_VERSION = "__DASHQL_VERSION__";
const DASHQL_COMMIT = "__DASHQL_COMMIT__";

const PROTOBUF_PATH = path.resolve(__dirname, "__PROTOBUF_PATH__");
const COMPUTE_PATH = path.resolve(__dirname, "__COMPUTE_PATH__");
const CORE_API_PATH = path.resolve(__dirname, "__CORE_API_PATH__");
const CORE_WASM_PATH = path.resolve(__dirname, "__CORE_WASM_PATH__");
const ZSTD_WASM_PATH = path.resolve(__dirname, "__ZSTD_WASM_PATH__");

export default vite.defineConfig(({ mode, command }) => {
    const isReloc = mode === 'reloc';
    const isTest = mode === 'test';
    const base = isReloc ? './' : '/';
    const rootDir = __dirname;

    return {
        plugins: [react()],
        publicDir: 'static',
        root: rootDir,
        base,
        build: {
            target: 'es2020',
            rollupOptions: {
                input: {
                    app: path.resolve(rootDir, "static/index.html"),
                    oauth_redirect: path.resolve(rootDir, "static/oauth.html"),
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
            'process.env.DASHQL_VERSION': JSON.stringify(DASHQL_VERSION),
            'process.env.DASHQL_GIT_COMMIT': JSON.stringify(DASHQL_COMMIT),
            'process.env.DASHQL_APP_URL': JSON.stringify(process.env.DASHQL_APP_URL || 'https://dashql.app'),
            'process.env.DASHQL_LOG_LEVEL': JSON.stringify(process.env.DASHQL_LOG_LEVEL || (command === 'serve' ? 'debug' : 'info')),
            'process.env.DASHQL_RELATIVE_IMPORTS': JSON.stringify(isReloc),
        },
        resolve: {
            alias: [
                { find: "@ankoh/dashql-protobuf", replacement: PROTOBUF_PATH },
                { find: "@ankoh/dashql-compute", replacement: COMPUTE_PATH },
                { find: "@ankoh/dashql-core", replacement: CORE_API_PATH },
                {
                    find: /^@ankoh\/dashql-core-wasm(\?.*)?$/,
                    replacement: CORE_WASM_PATH + "$1",
                },
                {
                    find: /^@bokuweb\/zstd-wasm\/dist\/web\/zstd.wasm(\?.*)?$/,
                    replacement: ZSTD_WASM_PATH + "$1",
                },
                // Test-only mocks for asset imports (replacing Jest moduleNameMapper)
                ...(isTest ? [
                    {
                      find: /\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|html|wasm)$/,
                      replacement: path.resolve(rootDir, "env/file_mock.ts")
                    },
                    {
                      find: /\.(css|styl|less|sass|scss)$/,
                      replacement: path.resolve(rootDir, "env/style_mock.ts")
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
            strictPort: false,
            hmr: true,
            cors: true,
            fs: { allow: ['..'] },
        },
        optimizeDeps: {
            include: ['react', 'react-dom', 'react-router-dom'],
        },
        worker: {
            format: 'es',
        },
        test: {
            globals: true,
            environment: 'jsdom',
            setupFiles: [path.resolve(rootDir, "env/vitest_setup.ts")],
            include: ["src/**/*.test.{ts,tsx}"],
            exclude: [
                "**/computation_state.test.ts",
                "**/compute_worker_bindings.test.ts",
                "**/view/editor/dashql_completion_hint.test.ts",
                "**/view/query_result/arrow_formatter.test.ts",
            ],
            reporter: 'default',
            coverage: { reporter: [], provider: undefined, enabled: false },
        },
    };
});
