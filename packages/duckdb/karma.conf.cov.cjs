const puppeteer = require('puppeteer');

process.env.CHROME_BIN = puppeteer.executablePath();

module.exports = function (config) {
    config.set({
        basePath: '../..',
        plugins: [
            'karma-jasmine',
            'karma-chrome-launcher',
            'karma-firefox-launcher',
            'karma-sourcemap-loader',
            'karma-spec-reporter',
            'karma-coverage',
        ],
        frameworks: ['jasmine'],
        files: [
            { pattern: 'packages/duckdb/dist/tests-browser.js' },
            { pattern: 'packages/duckdb/dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'packages/duckdb/dist/*.js', included: false, watched: false, served: true },
            { pattern: 'data/**/*.parquet', included: false, watched: false, served: true },
            { pattern: 'data/**/*.zip', included: false, watched: false, served: true },
        ],
        preprocessors: {
            '**/*.js': ['sourcemap', 'coverage'],
        },
        proxies: {
            '/static/': '/base/packages/duckdb/dist/',
            '/data/': '/base/data/',
        },
        exclude: [],
        reporters: ['dots', 'coverage'],
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
        coverageReporter: {
            type: 'json',
            dir: './packages/duckdb/coverage/',
            subdir: function (browser) {
                return browser.toLowerCase().split(/[ /-]/)[0];
            },
        },
        client: {
            jasmine: {
                failFast: true,
            },
        },
        captureTimeout: 300000,
        browserDisconnectTimeout: 10000,
        browserDisconnectTolerance: 1,
        browserNoActivityTimeout: 300000,
    });
};
