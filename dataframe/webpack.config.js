const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const browserTarget = {
    target: 'web',
    mode: 'production',
    entry: {
        dataframe: './src/index_web.ts',
    },
    devtool: 'source-map',
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'Dataframe',
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
                exclude: [/node_modules/, path.resolve(__dirname, 'test')],
                options: {
                    configFile: 'tsconfig.web.json',
                }
            },
            {
                test: /dataframe_wasm(_node)?\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: 'dataframe.wasm',
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
        dataframe_node: './src/index_node.ts',
    },
    externals: [nodeExternals({ importType: 'umd' })],
};
nodeTarget.module.rules[0] = {
    ...nodeTarget.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
};

module.exports = [browserTarget, nodeTarget];
