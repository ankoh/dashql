const common = require('./webpack.config.common.js');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

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
