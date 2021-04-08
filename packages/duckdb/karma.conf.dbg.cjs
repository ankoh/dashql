const puppeteer = require('puppeteer');

process.env.CHROME_BIN = puppeteer.executablePath();

module.exports = function (config) {
    config.set({
        basePath: '../..',
        plugins: ['karma-jasmine', 'karma-chrome-launcher', 'karma-sourcemap-loader', 'karma-jasmine-html-reporter'],
        frameworks: ['jasmine'],
        files: [
            { pattern: 'packages/duckdb/dist/tests-browser.js' },
            { pattern: 'packages/duckdb/dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'packages/duckdb/dist/*.js', included: false, watched: false, served: true },
            { pattern: 'data/uni/out/*.parquet', included: false, watched: false, served: true },
        ],
        preprocessors: {
            '**/*.js': ['sourcemap'],
        },
        proxies: {
            '/static/': '/base/packages/duckdb/dist/',
            '/data/': '/base/data/uni/out/',
        },
        exclude: [],
        reporters: ['kjhtml'],
        port: 9876,
        colors: true,
        logLevel: config.LOG_INFO,
        autoWatch: true,
        singleRun: false,
        browsers: ['Chrome'],
        client: {
            jasmine: {
                failFast: true,
            },
        },
    });
};
