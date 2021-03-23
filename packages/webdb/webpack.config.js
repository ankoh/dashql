import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import WebpackBar from 'webpackbar';
import CopyPlugin from 'copy-webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = {
    mode: 'production',
    devtool: 'source-map',
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
    experiments: {
        outputModule: true,
    },
    plugins: [
        new WebpackBar(),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, './src/webdb_wasm.wasm'),
                    to: path.resolve(__dirname, './dist/webdb.wasm'),
                },
            ],
        }),
        new webpack.WatchIgnorePlugin({
            paths: [/node_modules\/^(@dashql)/, path.resolve(__dirname, './dist/')],
        }),
    ],
};

const LIBRARY_UMD = {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'dist/',
    libraryTarget: 'umd',
    library: 'webdb',
    globalObject: 'this',
    devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]', // map to source with absolute file path not webpack:// protocol
};

const LIBRARY_ES6 = {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'dist/',
    libraryTarget: 'module',
    globalObject: 'this',
    devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]', // map to source with absolute file path not webpack:// protocol
};

const TS_EXCLUDES = [/node_modules/, path.resolve(__dirname, 'test')];

const TS_LOADER_WEB = {
    test: /\.ts$/,
    loader: 'ts-loader',
    exclude: TS_EXCLUDES,
    options: {
        configFile: 'tsconfig.web.json',
    },
};

const TS_LOADER_NODE = {
    test: /\.ts$/,
    loader: 'ts-loader',
    exclude: TS_EXCLUDES,
    options: {
        configFile: 'tsconfig.node.json',
    },
};

const NO_EXTERNALS = {};

const EXTERNALS = {
    '@dashql/proto': '@dashql/proto',
    flatbuffers: 'flatbuffers',
};

export default [
    /// Web Sync, UMD, Externals
    /// Web Async, UMD, Externals
    {
        ...base,
        target: 'web',
        output: LIBRARY_ES6,
        entry: {
            webdb: './src/index_web.ts',
            webdb_async: './src/index_async.ts',
        },
        module: {
            rules: [TS_LOADER_WEB],
        },
        externals: EXTERNALS,
    },

    //    /// Web Async Worker, UMD, Pre-bundled
    //    {
    //        ...base,
    //        target: 'web',
    //        output: LIBRARY_UMD,
    //        entry: {
    //            'webdb_async.worker': './src/worker_web.ts',
    //        },
    //        module: {
    //            rules: [TS_LOADER_WEB],
    //        },
    //        externals: NO_EXTERNALS,
    //    },

    /// Node Sync, UMD, Externals
    /// Node Async, UMD, Externals
    {
        ...base,
        target: 'node',
        output: LIBRARY_ES6,
        entry: {
            webdb_node: './src/index_web.ts',
            webdb_node_async: './src/index_async.ts',
        },
        module: {
            rules: [TS_LOADER_NODE],
        },
        externals: NO_EXTERNALS,
    },

    //    /// Node Async Worker, UMD, Externals
    //    {
    //        ...base,
    //        target: 'node',
    //        output: LIBRARY_UMD,
    //        entry: {
    //            'webdb_node_async.worker': './src/worker_web.ts',
    //        },
    //        module: {
    //            rules: [TS_LOADER_NODE],
    //        },
    //        externals: NO_EXTERNALS,
    //    },
];
