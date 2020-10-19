const path = require('path');
const nodeExternals = require('webpack-node-externals');
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const browserTarget = {
    target: 'web',
    mode: 'production',
    entry: {
        "duckdb_web": './src/lib_web.ts',
        "duckdb_web.worker": './src/lib_web.worker.ts'
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'DuckDB',
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
                    path.resolve(__dirname, 'test')
                ]
            },
            {
                test: /\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: '[hash].[ext]',
                }
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin({
            root: "./dist",
            cleanOnceBeforeBuildPatterns: ["*.wasm", "!.*"],
            cleanOnceAfterBuildPatterns: [],
            verbose: true,
        }),
    ],
    externals: {
        flatbuffers: "flatbuffers",
    }
};

const nodeTarget = {
    ...browserTarget,
    target: 'node',
    entry: {
        "duckdb_node": './src/lib_node.ts',
        "duckdb_node.worker": './src/lib_node.worker.ts'
    },
    plugins: [
        new CleanWebpackPlugin({
            root: "./dist",
            cleanOnceBeforeBuildPatterns: ["*.wasm", "!.*"],
            cleanOnceAfterBuildPatterns: [],
            verbose: true,
        }),
    ],
};
nodeTarget.module.rules[0] = {
    ...nodeTarget.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
}

module.exports = [browserTarget, nodeTarget];
