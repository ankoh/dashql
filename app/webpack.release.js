const common = require('./webpack.common.js');
const path = require('path');

const buildDir = path.resolve(__dirname, './build/release');

module.exports = {
    mode: 'production',
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
                        "sourceMap": false,
                    }
                }
            },
        ]
    },
    plugins: common.plugins,
    devtool: false,
    optimization: {
        splitChunks: common.optimization.splitChunks,
    },
}
