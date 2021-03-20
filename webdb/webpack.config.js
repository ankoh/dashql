const path = require('path');
const webpack = require('webpack');

const base = {
    mode: 'production',
    devtool: 'source-map',
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'dist/',
        library: 'webdb',
        libraryTarget: 'umd',
        umdNamedDefine: true,
        globalObject: 'this',
        devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]', // map to source with absolute file path not webpack:// protocol
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
                test: /webdb_wasm(_node)?\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: 'webdb.wasm',
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
    externals: {
        '@dashql/proto': 'dashql/proto',
        flatbuffers: 'flatbuffers',
    },
};

const webTargets = {
    ...base,
    target: 'web',
    entry: {
        webdb: './src/index_web.ts',
        webdb_async: './src/index_async.ts',
    },
};

const webWorkerTarget = {
    ...base,
    target: 'web',
    entry: {
        'webdb_async.worker': './src/worker_web.ts',
    },
    externals: {},
};

const nodeTargets = {
    ...base,
    target: 'node',
    entry: {
        webdb_node: './src/index_node.ts',
        webdb_node_async: './src/index_async.ts',
    },
};
nodeTargets.module.rules[0] = {
    ...base.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
};

const nodeWorkerTarget = {
    ...base,
    target: 'node',
    entry: {
        'webdb_node_async.worker': './src/worker_node.ts',
    },
    externals: {},
};
nodeWorkerTarget.module.rules[0] = {
    ...base.module.rules[0],
    options: { configFile: 'tsconfig.node.json' },
};

module.exports = [webTargets, webWorkerTarget, nodeTargets, nodeWorkerTarget];
