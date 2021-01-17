const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const WatchRunPlugin = require('./webpack/watch_run_plugin');

const browserTarget = {
    target: 'web',
    mode: 'production',
    entry: {
        dashql_core: './src/index_web.ts',
    },
    devtool: 'source-map',
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'DashQLCore',
        libraryTarget: 'umd',
        umdNamedDefine: true,
        globalObject: 'this',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader',
                exclude: [/node_modules/, path.resolve(__dirname, 'test')],
            },
            {
                test: /analyzer_wasm(_node)?\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: 'dashql_analyzer.wasm',
                },
            },
        ],
    },
    optimization: {
        moduleIds: 'deterministic',
        splitChunks: {
            chunks: 'async',
            minSize: 20000,
            minRemainingSize: 0,
            minChunks: 1,
            maxAsyncRequests: 30,
            maxInitialRequests: 30,
            automaticNameDelimiter: '~',
            enforceSizeThreshold: 50000,
            cacheGroups: {
                vendors: {
                    test: /[\\/]node_modules[\\/]/,
                    priority: -10,
                },
                default: {
                    minChunks: 2,
                    priority: -20,
                    reuseExistingChunk: true,
                },
            },
        },
    },
    plugins: [
        new CleanWebpackPlugin({
            root: './dist',
            cleanOnceBeforeBuildPatterns: ['*.wasm', '**/*.d.ts', '**/*.map', '!.*'],
            cleanOnceAfterBuildPatterns: [],
            verbose: false,
        }),
        new WatchRunPlugin(),
        new webpack.WatchIgnorePlugin({
            paths: [/node_modules\/^(@dashql)/, path.resolve(__dirname, './dist/')],
        }),
    ],
    externals: [nodeExternals({ importType: 'umd' })],
};

const nodeTarget = {
    ...browserTarget,
    target: 'node',
    entry: {
        dashql_core_node: './src/index_node.ts',
    },
    plugins: [
        new CleanWebpackPlugin({
            root: './dist',
            cleanOnceBeforeBuildPatterns: ['*.wasm', '!.*'],
            cleanOnceAfterBuildPatterns: [],
            verbose: false,
        }),
        new webpack.WatchIgnorePlugin({
            paths: [/node_modules\/^(@dashql)/, path.resolve(__dirname, './dist/')],
        }),
    ],
};
nodeTarget.module.rules[0] = {
    ...nodeTarget.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
};

module.exports = [browserTarget, nodeTarget];
