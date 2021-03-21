const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
    target: 'node',
    mode: 'production',
    entry: {
        bench_iterator: './src/iterator_benchmark.ts',
        bench_iterator_async: './src/iterator_benchmark_async.ts',
        bench_proxy: './src/proxy_benchmark.ts',
        bench_parser: './src/parser_benchmark.ts',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'benchmarks',
        libraryTarget: 'umd',
        umdNamedDefine: true,
        globalObject: 'this',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: [/node_modules/, path.resolve(__dirname, 'dist')],
            },
            {
                test: /.*\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: 'wasm/[name].[ext]',
                },
            },
            {
                test: /.*\.worker\.js$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: 'workers/[name].[ext]',
                },
            },
        ],
    },
    plugins: [
        new CleanWebpackPlugin({
            root: './dist',
            cleanOnceBeforeBuildPatterns: ['*.wasm', '**/*.d.ts', '!.*'],
            cleanOnceAfterBuildPatterns: [],
            verbose: true,
        }),
    ],
    externals: [
        nodeExternals({
            importType: 'umd',
            allowlist: [/.*\.wasm$/, /.*\.worker\.js$/],
        }),
    ],
};
