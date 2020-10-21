const common = require('./webpack.common.js');
const path = require('path');

const buildDir = path.resolve(__dirname, './build/debug');

module.exports = {
    mode: 'development',
    entry: common.entry,
    resolve: common.resolve,
    output: {
        ...common.output,
        path: buildDir
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
    plugins: common.plugins,
    performance: {
        hints: false
    },
    devtool: 'inline-source-map',
    devServer: {
        historyApiFallback: true,
        contentBase: path.join(__dirname, './build/debug'),
        compress: true,
        port: 9000
    }
}
