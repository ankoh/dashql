const common = require('./webpack.common.js');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: {
        app: ['./src/App.tsx'],
    },
    output: {
        path: path.resolve(__dirname, './build/release'),
        filename: '[name].js'
    },
    mode: 'production',
    devtool: false,
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
                        "sourceMap": false,
                    }
                }
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin()
    ]
}
