const path = require('path');
const InjectPlugin = require('webpack-inject-plugin').default;
const fs = require('fs');

module.exports = {
    entry: './src/index_browser.ts',
    mode: 'production',
    devtool: 'source-map',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader',
                options: { allowTsInNodeModules: true },
            },
        ],
        noParse: /sql\.js|node_modules\/benchmark/,
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bench-browser.js',
    },
    plugins: [
        new InjectPlugin(function () {
            return fs.readFileSync('./injects.js');
        }),
    ],
};
