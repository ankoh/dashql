const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

function configure(params) {
    return {
        entry: {
            app: ['./src/app.tsx'],
        },
        output: {
            path: params.buildDir,
            publicPath: '/',
            filename: 'static/js/[name].[fullhash:8].js',
            chunkFilename: 'static/js/[name].[fullhash:8].chunk.js',
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
                                modules: true,
                                sourceMap: true,
                            }
                        }
                    ]
                },
                {
                    test: /\.(ttf|eot|woff|woff2)$/,
                    loader: 'file-loader',
                    options: {
                        name: 'static/fonts/[name].[ext]'
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
                filename: './static/css/[name].css',
                chunkFilename: './static/css/[id].css'
            })
        ],
    };
}

module.exports = {
    configure
}

