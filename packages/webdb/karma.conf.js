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
        ],
    },
};

process.env.CHROME_BIN = require('puppeteer').executablePath();

module.exports = function (config) {
    config.set({
        basePath: './',
        frameworks: ['jasmine'],
        files: [
            { pattern: 'test/**/*.test.ts' },
            { pattern: 'dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'dist/*.js', included: false, watched: false, served: true },
        ],
        proxies: {
            '/static/webdb.wasm': '/base/dist/webdb.wasm',
            '/static/webdb_async.worker.js': '/base/dist/webdb_async.worker.js',
        },
        preprocessors: {
            'test/**/*.test.ts': ['webpack'],
        },
        exclude: [],
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
        singleRun: true,
        browsers: ['ChromeHeadlessNoSandbox', 'FirefoxHeadless'],
        customLaunchers: {
            ChromeHeadlessNoSandbox: {
                base: 'ChromeHeadless',
                flags: ['--no-sandbox'],
            },
        },
    });
};
