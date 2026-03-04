import CopyWebpackPlugin from 'copy-webpack-plugin';
import CopyWasmSourceMapPlugin from './wasm_map';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import webpack from 'webpack';
import * as webpackDevServer from 'webpack-dev-server';
import * as path from 'path';
import * as fs from 'fs';

// When DASHQL_APP_DIR is set we're in Bazel. Context must be package bin dir (where rule copies srcs).
// BAZEL_BINDIR is relative to execroot; cwd may be execroot or inside output tree (e.g. .../bin). Resolve from execroot.
function getConfigDir(): string {
    if (!process.env.DASHQL_APP_DIR) return process.cwd();
    const cwd = process.cwd();
    const appDir = process.env.DASHQL_APP_DIR;
    const bindir = process.env.BAZEL_BINDIR;
    if (!bindir) return path.join(cwd, appDir);
    if (path.isAbsolute(bindir)) return bindir;
    const normalized = path.normalize(bindir);
    let execroot = cwd;
    if (cwd.includes('bazel-out')) {
        let d = cwd;
        while (d.includes('bazel-out')) {
            d = path.dirname(d);
        }
        execroot = d;
    }
    const resolved = path.resolve(execroot, normalized);
    try {
        if (fs.existsSync(path.join(resolved, 'package.json')) && fs.existsSync(path.join(resolved, 'src'))) return resolved;
        const packageDir = path.join(resolved, appDir);
        if (fs.existsSync(path.join(packageDir, 'package.json'))) return packageDir;
    } catch {
        // ignore
    }
    return path.join(resolved, appDir);
}
const CONFIG_DIR = getConfigDir();

// Under Bazel, use a self-contained tsconfig that does not extend ../../tsconfig.json (not available in runfiles).
const TSCONFIG_FILE = process.env.DASHQL_APP_DIR ? 'tsconfig.bazel.json' : 'tsconfig.json';
const TSCONFIG_PATH = path.join(CONFIG_DIR, TSCONFIG_FILE);

export type Configuration = webpack.Configuration & {
    devServer?: webpackDevServer.Configuration;
};

interface ConfigParams {
    mode: 'production' | 'development';
    target?: string;
    buildDir?: string;
    relocatable: boolean;
    extractCss: boolean;
    cssIdentifier: string;
    appURL: string;
    logLevel: string;
}

const PACKAGE_JSON_PATH = path.join(CONFIG_DIR, 'package.json');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { version: string; gitCommit: string };

const CONFIG_PATH = 'static/config.[contenthash].json';

function findExecroot(): string | null {
    let d = process.cwd();
    for (let i = 0; i < 15; i++) {
        if (!d || d === path.dirname(d)) return null;
        if (fs.existsSync(path.join(d, 'MODULE.bazel')) || fs.existsSync(path.join(d, 'WORKSPACE')) || fs.existsSync(path.join(d, 'WORKSPACE.bazel'))) return d;
        d = path.dirname(d);
    }
    return null;
}

function resolveBazelPath(envValue: string | undefined): string | null {
    if (!envValue) return null;
    if (path.isAbsolute(envValue) && fs.existsSync(envValue)) return envValue;
    const execroot = findExecroot();
    const resolved = execroot ? path.resolve(execroot, envValue) : path.resolve(process.cwd(), envValue);
    return fs.existsSync(resolved) ? resolved : resolved;
}

export function configure(params: ConfigParams): Partial<Configuration> {
    // Under Bazel: NODE_PATH = overlay/node_modules + npm. Discover from env (if set) or RUNFILES_DIR (directory targets can't use execpath).
    let overlayResolved: string | null = null;
    let npmResolved: string | null = null;
    const overlayRaw = process.env.DASHQL_ANKOH_OVERLAY;
    const npmRaw = process.env.DASHQL_NPM_NODE_MODULES;
    if (overlayRaw && npmRaw) {
        overlayResolved = resolveBazelPath(overlayRaw);
        npmResolved = resolveBazelPath(npmRaw);
        const overlayNodeModules = overlayResolved ? path.join(overlayResolved, 'node_modules') : null;
        const entries = [overlayNodeModules, npmResolved].filter(Boolean);
        if (entries.length) process.env.NODE_PATH = entries.join(path.delimiter) + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
    } else if (process.env.DASHQL_APP_DIR && process.env.RUNFILES_DIR) {
        const main = path.join(process.env.RUNFILES_DIR, process.env.RUNFILES_MAIN_REPO || '_main');
        const overlay = path.join(main, 'packages', 'dashql-app', 'ankoh_overlay');
        const npm = path.join(main, 'node_modules');
        if (fs.existsSync(npm)) {
            npmResolved = npm;
            overlayResolved = fs.existsSync(overlay) ? overlay : null;
            const overlayNodeModules = overlayResolved ? path.join(overlayResolved, 'node_modules') : null;
            const entries = [overlayNodeModules, npm].filter(Boolean);
            if (entries.length) process.env.NODE_PATH = entries.join(path.delimiter) + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
        }
    }
    const rawNodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
    let nodePaths = rawNodePaths;
    if (process.env.DASHQL_APP_DIR && CONFIG_DIR && rawNodePaths.length === 0) {
        const binRootFromConfig = path.resolve(CONFIG_DIR, '..', '..');
        const nmBin = path.join(binRootFromConfig, 'node_modules');
        if (fs.existsSync(nmBin)) process.env.NODE_PATH = nmBin;
        nodePaths = [path.resolve(binRootFromConfig, 'node_modules'), path.resolve(binRootFromConfig)].concat(rawNodePaths);
    }
    const binRoot = process.env.DASHQL_APP_DIR ? path.resolve(CONFIG_DIR, '..', '..') : null;
    const resolveModules =
        process.env.DASHQL_APP_DIR && overlayResolved != null && npmResolved
            ? [path.join(overlayResolved, 'node_modules'), npmResolved, CONFIG_DIR]
            : process.env.DASHQL_APP_DIR && binRoot
              ? [binRoot]
              : [
                    ...nodePaths,
                    path.join(process.cwd(), 'node_modules'),
                    'node_modules',
                ].filter(Boolean);
    if (process.env.DASHQL_DEBUG_RESOLVE === '1') {
        process.stderr.write('[DASHQL] resolve.modules count=' + resolveModules.length + ' first=' + (resolveModules[0] ?? '') + '\n');
    }

    return {
        mode: params.mode,
        target: params.target,
        context: CONFIG_DIR,
        entry: {
            'app': ['./src/app.tsx'],
            'oauth_redirect': ['./src/oauth_redirect.tsx'],
        },
        output: {
            path: params.buildDir,
            filename: 'static/js/[name].[contenthash].js',
            chunkFilename: 'static/js/[name].[contenthash].js',
            assetModuleFilename: 'static/assets/[name].[contenthash][ext]',
            globalObject: 'globalThis',
            clean: true,
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.mjs', '.jsx', '.css', '.wasm'],
            extensionAlias: {
                '.js': ['.js', '.jsx', '.ts', '.tsx'],
            },
            modules: resolveModules,
        },
        resolveLoader: {
            modules: resolveModules,
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: 'esbuild-loader',
                    exclude: /node_modules/,
                    options: {
                        loader: 'tsx',
                        target: 'es2020',
                        tsconfig: TSCONFIG_PATH,
                    },
                },
                {
                    test: /\.css$/,
                    use: [
                        params.extractCss ? MiniCssExtractPlugin.loader : 'style-loader',
                        {
                            loader: 'css-loader',
                            options: {
                                modules: {
                                    mode: 'local',
                                    auto: true,
                                    exportGlobals: true,
                                    localIdentName: params.cssIdentifier,
                                    localIdentContext: path.join(CONFIG_DIR, 'src'),
                                },
                            },
                        },
                    ],
                },
                {
                    test: /.*\.wasm$/,
                    type: 'asset/resource',
                    generator: { filename: 'static/wasm/[name].[contenthash][ext]' },
                },
                {
                    test: /.*\.wasm.map$/,
                    type: 'asset/resource',
                    generator: { filename: 'static/wasm/[name][ext]' },
                },
                {
                    test: /\.(sql)$/i,
                    type: 'asset/resource',
                    generator: { filename: 'static/scripts/[name].[contenthash][ext]' },
                },
                {
                    test: /\.(png|jpe?g|gif|ico)$/i,
                    type: 'asset/resource',
                    generator: { filename: 'static/img/[name].[contenthash][ext]' },
                },
                {
                    test: /\.svg$/i,
                    use: [
                        { loader: 'file-loader', options: { name: 'static/img/[name].[contenthash].[ext]' } },
                    ],
                },
                {
                    test: /\.(ttf)$/i,
                    type: 'asset/resource',
                    generator: { filename: 'static/fonts/[name].[contenthash][ext]' },
                },
                {
                    test: /.*\/static\/config\.json$/i,
                    type: 'asset/resource',
                    generator: { filename: CONFIG_PATH },
                },
            ],
        },
        optimization: {
            chunkIds: 'deterministic',
            moduleIds: 'deterministic',
        },
        plugins: [
            new CopyWasmSourceMapPlugin(),
            // Skip type-check under Bazel: runfiles layout prevents ForkTsChecker from resolving @types.
            ...(process.env.DASHQL_APP_DIR
                ? []
                : [
                    new ForkTsCheckerWebpackPlugin({
                        typescript: {
                            configFile: TSCONFIG_PATH,
                            memoryLimit: 4096,
                        },
                    }),
                ]),
            new HtmlWebpackPlugin({
                chunks: ['app'],
                template: './static/index.html',
                filename: './index.html',
                base: params.relocatable ? './' : '/',
            }),
            new HtmlWebpackPlugin({
                chunks: ['oauth_redirect'],
                template: './static/oauth.html',
                filename: './oauth.html',
                base: params.relocatable ? './' : '/',
            }),
            new webpack.DefinePlugin({
                'process.env.DASHQL_BUILD_MODE': JSON.stringify(params.mode),
                'process.env.DASHQL_VERSION': JSON.stringify(PACKAGE_JSON.version),
                'process.env.DASHQL_GIT_COMMIT': JSON.stringify(PACKAGE_JSON.gitCommit),
                'process.env.DASHQL_APP_URL': JSON.stringify(params.appURL),
                'process.env.DASHQL_LOG_LEVEL': JSON.stringify(params.logLevel),
                'process.env.DASHQL_RELATIVE_IMPORTS': params.relocatable,
            }),
            new MiniCssExtractPlugin({
                filename: './static/css/[id].[contenthash].css',
                chunkFilename: './static/css/[id].[contenthash].css',
            }),
            new CopyWebpackPlugin({
                patterns: [{ from: './static/favicons', to: './static/favicons' }],
            }),
        ],
        experiments: {
            asyncWebAssembly: true,
        },
    };
}
