const common = require('./webpack.common.js');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// Detect environment
const isProduction = typeof NODE_ENV !== 'undefined' && NODE_ENV === 'production';

module.exports = {
    entry: {
        app: ['./src/App.tsx'],
    },
    output: {
        path: path.resolve(__dirname, './build/debug'),
        filename: '[name].js'
    },
    mode: 'development',
    devtool: 'inline-source-map',
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".jsx"]
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: {
                    compilerOptions: {
                        "sourceMap": true,
                    }
                }
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin()
    ],
    performance: {
        hints: false
    },
    devServer: {
        contentBase: path.join(__dirname, './build/debug'),
        compress: true,
        port: 9000
    }
}
