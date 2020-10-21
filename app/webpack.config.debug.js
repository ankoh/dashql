const common = require('./webpack.config.common.js');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const buildDir = path.resolve(__dirname, './build/debug');

module.exports = {
    entry: common.entry,
    resolve: common.resolve,
    output: {
        ...common.output,
        path: buildDir
    },
    mode: 'development',
    devtool: 'inline-source-map',
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
        new CleanWebpackPlugin({
            verbose: false,
        }),
        new HtmlWebpackPlugin({
            template: "./public/index.html",
            filename: "./index.html",
            favicon: './public/favicon.ico'
        })
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
