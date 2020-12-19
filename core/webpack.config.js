const path = require('path');
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CompressionPlugin = require('compression-webpack-plugin');

const browserTarget = {
    target: 'web',
    mode: 'production',
    entry: {
        "dashql_core_web": './src/index_web.ts'
    },
    devtool: 'source-map',
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'DashQLCore',
        libraryTarget: 'umd',
        umdNamedDefine: true,
        globalObject: 'this'
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            "@dashql/proto": path.resolve(__dirname, '../proto/dashql_proto.ts')
        }
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
                test: /core_wasm(_node)?\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: 'dashql_core.wasm',
                }
            }
        ]
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
                }
            }
        }
    },
    plugins: [
        new CleanWebpackPlugin({
            root: "./dist",
            cleanOnceBeforeBuildPatterns: ["*.wasm", "!.*"],
            cleanOnceAfterBuildPatterns: [],
            verbose: true,
        }),
        new CompressionPlugin({
            filename: "[path][base].gz",
            algorithm: 'gzip',
            test: /\.js$|\.css$|\.html$|\.eot$|\.ttf$|\.woff$|\.svg$|\.json$|\.wasm$/,
            threshold: 10240,
            minRatio: 0.8
        })
    ],
    externals: {
        flatbuffers: "flatbuffers",
    }
};

const nodeTarget = {
    ...browserTarget,
    target: 'node',
    entry: {
        "dashql_core_node": './src/index_node.ts'
    },
    plugins: [
        new CleanWebpackPlugin({
            root: "./dist",
            cleanOnceBeforeBuildPatterns: ["*.wasm", "!.*"],
            cleanOnceAfterBuildPatterns: [],
            verbose: true,
        }),
        new CompressionPlugin({
            filename: "[path][base].gz",
            algorithm: 'gzip',
            test: /\.js$|\.css$|\.html$|\.eot$|\.ttf$|\.woff$|\.svg$|\.json$|\.wasm$/,
            threshold: 10240,
            minRatio: 0.8
        })
    ],
};
nodeTarget.module.rules[0] = {
    ...nodeTarget.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
}

module.exports = [browserTarget, nodeTarget];

