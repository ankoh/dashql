import react from "@vitejs/plugin-react";
import * as vite from "vite";
import * as path from "node:path";

const PROTOBUF_PATH = path.resolve(__dirname, "__PROTOBUF_PATH__");
const COMPUTE_PATH = path.resolve(__dirname, "__COMPUTE_PATH__");
const CORE_API_PATH = path.resolve(__dirname, "__CORE_API_PATH__");
const CORE_WASM_PATH = path.resolve(__dirname, "__CORE_WASM_PATH__");
const ZSTD_WASM_PATH = path.resolve(__dirname, "__ZSTD_WASM_PATH__");

const DASHQL_VERSION = "__DASHQL_VERSION__";
const DASHQL_COMMIT = "__DASHQL_COMMIT__";

export default vite.defineConfig(({ mode, command }) => {
    const isReloc = mode === 'reloc';
    const base = isReloc ? './' : '/';

    return {
        plugins: [react()],
        publicDir: 'static',
        root: __dirname,
        base,
        build: {
            target: 'es2020',
            rollupOptions: {
                input: {
                    app: path.resolve(__dirname, "index.html"),
                    oauth_redirect: path.resolve(__dirname, "oauth.html"),
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
    };
});
