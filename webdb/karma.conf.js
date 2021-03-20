const path = require('path');
const os = require('os');
const fs = require('fs');

const wd = path.join(os.tmpdir(), '_karma_webpack_');
console.log(wd);
if (fs.existsSync(wd)) {
    fs.rmdirSync(wd, {recursive: true})
}

const webpackConfig = {
    mode: 'development',
    output: {
        filename: '[name].js',
        path: wd,
        publicPath: '/',
    },
    stats: {
        modules: false,
        colors: true,
    },
    watch: false,
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: [/node_modules/],
            },
            {
                test: /webdb_wasm(_node)?\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
            },
        ],
    },
};

process.env.CHROME_BIN = require('puppeteer').executablePath()

module.exports = function (config) {
    config.set({
        basePath: './',
        frameworks: ['jasmine'],
        files: [
            { pattern: 'test/test_index.js' }
        ],
        proxies: {
            "/dist/": "http://localhost:9876/base/dist/"
        },
        exclude: [],
        preprocessors: {
            'test/test_index.js': ['webpack'],
        },
        webpack: webpackConfig,
        webpackMiddleware: {
            noInfo: true,
            stats: {
                chunks: false,
            },
        },
        reporters: ['progress'],
        port: 9876,
        colors: true,
        logLevel: config.LOG_DEBUG,
        autoWatch: true,
        browsers: ['ChromeHeadless'],
        singleRun: false
    });
};
