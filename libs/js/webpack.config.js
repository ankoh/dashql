const path = require('path');
const nodeExternals = require('webpack-node-externals');
const webpack = require('webpack');

const browserTarget = {
    target: 'web',
    mode: 'production',
    entry: {
        "duckdb_web": './src/duckdb_web.ts',
        "duckdb_web.worker": './src/duckdb_web.worker.ts'
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
    externals: {
        flatbuffers: "flatbuffers",
    }
};

const nodeTarget = {
    ...browserTarget,
    target: 'node',
    entry: {
        "duckdb_node": './src/duckdb_node.ts',
        "duckdb_node.worker": './src/duckdb_node.worker.ts'
    }
};
nodeTarget.module.rules[0] = {
    ...nodeTarget.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
}

module.exports = [browserTarget, nodeTarget];
