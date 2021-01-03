const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
    target: 'node',
    mode: 'production',
    entry: {
        "bench_iterator": './src/iterator_benchmark.ts',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'benchmarks',
        libraryTarget: 'umd',
        umdNamedDefine: true,
        globalObject: 'this'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: [
                    /node_modules/,
                    path.resolve(__dirname, 'dist')
                ]
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin({
            root: "./dist",
            cleanOnceBeforeBuildPatterns: ["*.wasm", "**/*.d.ts", "!.*"],
            cleanOnceAfterBuildPatterns: [],
            verbose: true,
        }),
    ],
    externals: [nodeExternals()]
};
