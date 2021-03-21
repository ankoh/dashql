const path = require('path');
const os = require('os');
const fs = require('fs');

const wd = path.join(os.tmpdir(), '_karma_webpack_dashql_webdb_');
console.log(wd);
if (fs.existsSync(wd)) {
    fs.rmdirSync(wd, { recursive: true });
}

// TODO load existing webpack config
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
                options: {
                    configFile: __dirname + '/tsconfig.test.json',
                },
            },
            {
                test: /\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
            },
        ],
    },
};

process.env.CHROME_BIN = require('puppeteer').executablePath();

module.exports = function (config) {
    config.set({
        basePath: './',
        frameworks: ['jasmine'],
        files: [
            { pattern: 'test/test_index.js' },
            { pattern: 'dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'dist/*.js', included: false, watched: false, served: true },
        ],
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
        reporters: ['spec'],
        port: 9876,
        colors: true,
        logLevel: config.LOG_INFO,
        autoWatch: true,
        browsers: ['ChromeHeadless'],
        singleRun: true,
    });
};
