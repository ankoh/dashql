const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
    entry: {
        app: ['./src/App.tsx'],
    },
    output: {
        filename: 'static/js/[name].[hash:8].js',
        chunkFilename: 'static/js/[name].[hash:8].chunk.js',
        publicPath: '/'
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".jsx"]
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
