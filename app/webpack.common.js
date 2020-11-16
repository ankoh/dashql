const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

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
            })
        ]
    };
}

module.exports = {
    configure
}

