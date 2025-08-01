import webpack from 'webpack';
import * as webpackDevServer from 'webpack-dev-server';
import * as url from 'url';

import { configure } from './webpack.common.js';

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
        aggregateTimeout: 200,
        poll: false,
    },
    performance: {
        hints: false,
    },
    // Use cheap-module-source-map for good debugging with reasonable memory usage
    devtool: 'cheap-module-source-map',
    optimization: {
        ...base.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
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
        },
    },
};
export default config;
