const { configure } = require('./webpack.common.js');
const path = require('path');

module.exports = {
    ...configure({
        buildDir: path.resolve(__dirname, './build/debug'),
        tsLoaderOptions: {
            compilerOptions: {
                configFile: './tsconfig.json',
                sourceMap: true,
            }
        },
        extractCss: false,
        cssIdentifier: '[local]_[hash:base64]'
    }),
    mode: 'development',
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
