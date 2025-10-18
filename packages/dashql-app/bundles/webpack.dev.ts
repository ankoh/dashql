import webpack from 'webpack';
import * as webpackDevServer from 'webpack-dev-server';
import * as url from 'url';

import { configure } from './webpack.common.js';
import { MemoryMonitorPlugin } from './memory_monitor.js';

export type Configuration = webpack.Configuration & {
    devServer?: webpackDevServer.Configuration;
};

const base = configure({
    mode: 'development',
    target: 'web',
    buildDir: url.fileURLToPath(new URL('../build/dev', import.meta.url)),
    tsLoaderOptions: {
        compilerOptions: {
            sourceMap: true,
        },
    },
    relocatable: false,
    extractCss: false,
    cssIdentifier: '[local]_[hash:base64]',
    appURL: process.env.DASHQL_APP_URL ?? 'https://dashql.app',
    logLevel: process.env.DASHQL_LOG_LEVEL ?? 'debug',
});

const config: Configuration = {
    ...base,
    watchOptions: {
        ignored: ['node_modules/**', 'build/**', '**/*.wasm', '**/*.sql'],
        aggregateTimeout: 300,
        poll: false,
    },
    performance: {
        hints: false,
    },
    devtool: 'cheap-module-source-map',
    optimization: {
        ...base.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
    },
    cache: {
        type: 'memory',
        maxGenerations: 4,
    },
    devServer: {
        historyApiFallback: true,
        compress: true,
        hot: true,
        liveReload: false, // Disable liveReload when hot is enabled
        port: 9002,
        static: {
            directory: url.fileURLToPath(new URL('./build/pwa/dev/static', import.meta.url)),
        },
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
        },
        client: {
            overlay: {
                errors: true,
                warnings: false,
            },
            // Reduce WebSocket reconnection attempts
            reconnect: 3,
        },
        // Add dev server memory optimizations
        devMiddleware: {
            writeToDisk: false, // Keep everything in memory but limit it
        },
        // Reduce memory usage by limiting concurrent connections
        setupMiddlewares: (middlewares, devServer) => {
            // Force garbage collection every 50 requests in development
            let requestCount = 0;
            devServer.app?.use((req, res, next) => {
                requestCount++;
                if (requestCount % 50 === 0 && global.gc) {
                    global.gc();
                }
                next();
            });
            return middlewares;
        },
    },
    plugins: [
        ...(base.plugins || []),
        new MemoryMonitorPlugin({
            interval: 10000, // Check every 10 seconds
            threshold: 2 * 1024 * 1024 * 1024, // Force GC at 2GB
            logMemory: true,
        }),
    ],
};
export default config;
