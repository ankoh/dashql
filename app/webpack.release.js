const { configure } = require('./webpack.common.js');
const path = require('path');

module.exports = {
    ...configure({
        buildDir: path.resolve(__dirname, './build/release'),
        tsLoaderOptions: {
            compilerOptions: {
                configFile: './tsconfig.json',
                sourceMap: false,
            }
        },
        extractCss: true
    }),
    mode: 'production',
    devtool: false
}
