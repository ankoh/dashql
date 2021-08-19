import CopyWebpackPlugin from 'copy-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin';
import childProcess from 'child_process';
import path from 'path';
import webpack from 'webpack';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/// IMPORTANT
///
/// We use a dedicated tiny html file for the OAuth callback to not inflate the whole app in the popup.
/// However the EXACT OAuth callback URI has to be configured in the GitHub web interface.
/// If we would load the file using webpacks [contenthash], we would get cache busting but could break OAuth for our users without really noticing it.
//
/// We therefore use an explicit version file.
/// If you don't change the version file, you don't have to change the redirect URI but an updated file won't bust the CDN cache.
/// If you change the version file, you have to change the redirect URI and get cache busting automatically.
const GITHUB_OAUTH_VERSION_FILE = path.resolve(__dirname, './src/auth/github_oauth.html.version');
const GITHUB_OAUTH_VERSION = childProcess.execSync(`cat ${GITHUB_OAUTH_VERSION_FILE}`).toString().trim();

/// We support dynamic configurations of DashQL via a dedicated config file.
/// The app loads this file at startup which allows us to adjust certain settings dynamically.
///
/// By default, the name of this config file includes the content hash for our own cache-busting.
/// A more "generic" build of DashQL should set this path to 'static/config.json'.
/// For example, we may want to provide a docker image for on-premise deployments that mounts a user-provided config.
const CONFIG_PATH = 'static/config.[contenthash].json';

export function configure(params) {
    return {
        target: 'web',
        entry: {
            app: ['./src/app.tsx'],
        },
        output: {
            path: params.buildDir,
            publicPath: '/',
            filename: 'static/js/[name].[contenthash].js',
            chunkFilename: 'static/js/[name].[contenthash].js',
            assetModuleFilename: 'static/assets/[name].[contenthash].[ext]',
            clean: true,
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: 'ts-loader',
                    exclude: /node_modules/,
                    options: params.tsLoaderOptions,
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
                                    localIdentContext: path.resolve(__dirname, 'src'),
                                },
                            },
                        },
                    ],
                },
                {
                    test: /static\/config\.json$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: CONFIG_PATH,
                    },
                },
                {
                    test: /examples\/.*\.dashql$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: 'static/examples/[name].[contenthash].[ext]',
                    },
                },
                {
                    test: /\.(png|jpe?g|gif|svg)$/i,
                    type: 'asset/resource',
                    generator: {
                        filename: 'static/img/[name].[contenthash].[ext]',
                    },
                },
                {
                    test: /\.(ttf|eot|woff|woff2)$/,
                    type: 'asset/resource',
                    generator: {
                        filename: 'static/fonts/[name].[contenthash].[ext]',
                    },
                },
                {
                    test: /.*\.wasm$/,
                    type: 'asset/resource',
                    generator: {
                        filename: 'static/wasm/[contenthash].[ext]',
                    },
                },
                {
                    test: /.*github_oauth\.html$/,
                    type: 'asset/resource',
                    generator: {
                        filename: `static/html/[name].${GITHUB_OAUTH_VERSION}[ext]`,
                    },
                },
            ],
        },
        optimization: {
            moduleIds: 'deterministic',
            splitChunks: {
                chunks: 'all',
                cacheGroups: {
                    vendors: {
                        test: /[\\/]node_modules[\\/]/,
                        priority: -10,
                    },
                    default: {
                        priority: -20,
                        reuseExistingChunk: true,
                    },
                },
            },
        },
        plugins: [
            new webpack.ProgressPlugin(),
            new HtmlWebpackPlugin({
                template: './static/index.html',
                filename: './index.html',
                favicon: './static/favicon.ico',
            }),
            new MiniCssExtractPlugin({
                filename: './static/css/[id].[contenthash].css',
                chunkFilename: './static/css/[id].[contenthash].css',
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: './static/favicons',
                        to: './static/favicons',
                    },
                ],
            }),
            new webpack.DefinePlugin({
                'process.env': {
                    PUBLIC_URL: JSON.stringify(process.env.PUBLIC_URL),
                    GITHUB_OAUTH_CLIENT_ID: JSON.stringify('286d19fc45d2e4e826d6'),
                },
            }),
            new MonacoWebpackPlugin({
                features: ['clipboard', 'links'],
                languages: [],
                filename: './static/workers/[hash].[name].worker.js',
            }),
        ],
    };
}
