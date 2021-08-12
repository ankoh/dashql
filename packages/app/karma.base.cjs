const path = require('path');

process.env.CHROME_BIN = require('puppeteer').executablePath();

const JS_TIMEOUT = 900000;

module.exports = function (config) {
    return {
        basePath: '../..',
        plugins: [
            'karma-jasmine',
            'karma-chrome-launcher',
            'karma-firefox-launcher',
            'karma-sourcemap-loader',
            'karma-spec-reporter',
            'karma-coverage',
            'karma-jasmine-html-reporter',
        ],
        frameworks: ['jasmine'],
        files: [
            { pattern: 'packages/app/build/libs/tests-browser.js' },
            { pattern: 'packages/app/build/libs/tests-browser.js.map', included: false },
            { pattern: 'packages/app/src/analyzer/analyzer_wasm.wasm', included: false, watched: false, served: true },
            { pattern: 'packages/app/src/jmespath/jmespath_wasm.wasm', included: false, watched: false, served: true },
            { pattern: 'node_modules/@dashql/duckdb/dist/*.js', included: false, watched: false, served: true },
            { pattern: 'node_modules/@dashql/duckdb/dist/*.wasm', included: false, watched: false, served: true },
        ],
        preprocessors: {
            'tests-**/*.js': ['sourcemap', 'coverage'],
        },
        proxies: {
            '/static/jmespath_wasm.wasm': '/base/packages/app/src/jmespath/jmespath_wasm.wasm',
            '/static/analyzer_wasm.wasm': '/base/packages/app/src/analyzer/analyzer_wasm.wasm',
            '/static/duckdb/': '/base/node_modules/@dashql/duckdb/dist/',
            '/data/': '/base/data/',
        },
        exclude: [],
        port: 9876,
        colors: true,
        logLevel: config.LOG_INFO,
        autoWatch: true,
        singleRun: true,
        //browsers: ['ChromeHeadlessNoSandbox', 'FirefoxHeadless'],
        browsers: ['ChromeHeadlessNoSandbox'],
        customLaunchers: {
            ChromeHeadlessNoSandbox: {
                base: 'ChromeHeadless',
                flags: ['--no-sandbox'],
            },
        },
        specReporter: {
            maxLogLines: 5,
            suppressErrorSummary: true,
            suppressFailed: false,
            suppressPassed: false,
            suppressSkipped: true,
            showSpecTiming: true,
            prefixes: {
                success: '    OK: ',
                failure: 'FAILED: ',
                skipped: 'SKIPPED: ',
            },
        },
        coverageReporter: {
            type: 'json',
            dir: './packages/app/coverage/',
            subdir: function (browser) {
                return browser.toLowerCase().split(/[ /-]/)[0];
            },
        },
        client: {
            jasmine: {
                timeoutInterval: JS_TIMEOUT,
            },
        },
        captureTimeout: JS_TIMEOUT,
        browserDisconnectTimeout: JS_TIMEOUT,
        browserDisconnectTolerance: 1,
        browserNoActivityTimeout: JS_TIMEOUT,
        processKillTimeout: JS_TIMEOUT,
        concurrency: 1,
    };
};
