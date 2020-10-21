const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

function configure(params) {
    return {
        entry: {
            app: ['./src/App.tsx'],
        },
        output: {
            path: params.buildDir,
            publicPath: '/',
            filename: 'static/js/[name].[hash:8].js',
            chunkFilename: 'static/js/[name].[hash:8].chunk.js',
        },
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".jsx", ".css"]
        },
        plugins: [
            new CleanWebpackPlugin({
                verbose: false,
            }),
            new HtmlWebpackPlugin({
                template: "./public/index.html",
                filename: "./index.html",
                favicon: './public/favicon.ico'
            })
        ],
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: 'ts-loader',
                    exclude: /node_modules/,
                    options: {
                        compilerOptions: {
                            'sourceMap': true,
                        }
                    }
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
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
        }
    };
}

module.exports = {
    configure
}

