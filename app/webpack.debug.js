const common = require('./webpack.common.js');
const path = require('path');

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
    plugins: common.plugins,
    performance: {
        hints: false
    },
    devServer: {
        contentBase: path.join(__dirname, './build/debug'),
        compress: true,
        port: 9000
    }
}
