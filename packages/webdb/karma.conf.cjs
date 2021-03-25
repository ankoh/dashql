const puppeteer = require('puppeteer');

process.env.CHROME_BIN = puppeteer.executablePath();

module.exports = function(config) {
    config.set({
        basePath: '../..',
        plugins: [
            'karma-jasmine',
            'karma-chrome-launcher',
            'karma-firefox-launcher',
            'karma-sourcemap-loader',
            'karma-spec-reporter',
        ],
        frameworks: ['jasmine'],
        files: [
            { pattern: 'packages/webdb/dist/tests-browser.js' },
            { pattern: 'packages/webdb/dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'packages/webdb/dist/*.js', included: false, watched: false, served: true },
            { pattern: 'data/uni/out/*.parquet', included: false, watched: false, served: true },
        ],
        preprocessors: {
            '**/*.js': ['sourcemap'],
        },
        proxies: {
            '/static/': '/base/packages/webdb/dist/',
            '/data/': '/base/data/uni/out/',
        },
        exclude: [],
        reporters: ['dots'],
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
            dir: './coverage/',
            subdir: function(browser) {
                return browser.toLowerCase().split(/[ /-]/)[0];
            },
        },
        client: {
            jasmine: {
                failFast: true,
            },
        },
    });
};