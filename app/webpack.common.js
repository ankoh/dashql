const childProcess = require('child_process');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

/// IMPORTANT
///
/// We use a dedicated tiny html file for the OAuth callback to not inflate the whole app in the popup.
/// However the EXACT OAuth callback URI has to be configured in the GitHub web interface.
/// If we would load the file using webpacks [contenthash], we would get cache busting but would immediately break
/// OAuth for our users without really noticing it.
//
/// We therefore use an explicit version file.
/// If you don't change the version file, you don't have to change redirect the URI but an updated file won't bust the CDN cache.
/// If you change the version file, you have to change the redirect URI and get cache busting automatically.
const GITHUB_OAUTH_VERSION_FILE = path.resolve(__dirname, './src/auth/github_oauth.html.version')
const GITHUB_OAUTH_VERSION = childProcess.execSync(`cat ${GITHUB_OAUTH_VERSION_FILE}`).toString().trim();

function configure(params) {
    return {
        entry: {
            app: ['./src/app.tsx'],
        },
        output: {
            path: params.buildDir,
            publicPath: '/',
            filename: 'static/js/[name].[contenthash].js',
            chunkFilename: 'static/js/[name].[contenthash].js',
        },
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".jsx", ".css"]
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: 'ts-loader',
                    exclude: /node_modules/,
                    options: params.tsLoaderOptions
                },
                {
                    test: /\.css$/,
                    use: [
                        params.extractCss ? MiniCssExtractPlugin.loader : 'style-loader',
                        {
                            loader: "css-loader",
                            options: {
                                modules: {
                                    compileType: 'module',
                                    mode: 'local',
                                    auto: true,
                                    exportGlobals: true,
                                    localIdentName: params.cssIdentifier,
                                    localIdentContext: path.resolve(__dirname, 'src')
                                },
                            }
                        }
                    ]
                },
                {
                    test: /\.(png|jpe?g|gif)$/i,
                    loader: 'file-loader',
                    options: {
                        name: 'static/img/[name].[contenthash].[ext]'
                    }
                },
                {
                    test: /\.(ttf|eot|woff|woff2)$/,
                    loader: 'file-loader',
                    options: {
                        name: 'static/fonts/[name].[contenthash].[ext]'
                    }
                },
                {
                    test: /.*\.wasm$/,
                    type: 'javascript/auto',
                    loader: 'file-loader',
                    options: {
                        name: 'static/wasm/[contenthash].[ext]',
                    }
                },
                {
                    type: 'javascript/auto',
                    loader: 'file-loader',
                    test: /.*github_oauth\.html$/,
                    options: {
                        name: `static/html/[name].${GITHUB_OAUTH_VERSION}.[ext]`,
                    }
                }
            ]
        },
        optimization: {
            splitChunks: {
                chunks: 'all',
                minSize: 30000,
                minChunks: 1,
                maxAsyncRequests: 5,
                maxInitialRequests: 3,
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
                verbose: false,
            }),
            new HtmlWebpackPlugin({
                template: "./public/index.html",
                filename: "./index.html",
                favicon: './public/favicon.ico'
            }),
            new MiniCssExtractPlugin({
                filename: './static/css/[id].[contenthash].css',
                chunkFilename: './static/css/[id].[contenthash].css'
            }),
            new MonacoWebpackPlugin({
                languages: ['sql'],
                features: [],
                filename: './static/workers/[contenthash].worker.js'
            }),
            new webpack.DefinePlugin({
                // Referenced by react-flow...
                'process.env.FORCE_SIMILAR_INSTEAD_OF_MAP': JSON.stringify(process.env.FORCE_SIMILAR_INSTEAD_OF_MAP)
            })
        ]
    };
}

module.exports = {
    configure
}

