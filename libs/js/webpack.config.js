const path = require('path');
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const browserTarget = {
    target: 'web',
    mode: 'production',
    entry: {
        "targets/web/duckdb": './src/targets/web/duckdb.ts',
        "targets/web/duckdb_worker": './src/targets/web/duckdb_worker.ts'
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
            cleanOnceBeforeBuildPatterns: ["*.wasm", "**/*.d.ts", "!.*"],
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
        "targets/node/duckdb": './src/targets/node/duckdb.ts',
        "targets/node/duckdb_worker": './src/targets/node/duckdb_worker.ts'
    },
    plugins: [
        new CleanWebpackPlugin({
            root: "./dist",
            cleanOnceBeforeBuildPatterns: ["!.*"],
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
