const path = require('path');

process.env.CHROME_BIN = require('puppeteer').executablePath();

const JS_TIMEOUT = 900000;

const DUCKDB_WASM = '../../node_modules/@dashql/duckdb/dist/duckdb.wasm';
const DUCKDB_WORKER = '../../node_modules/@dashql/duckdb/dist/duckdb-browser-parallel.worker.js';

module.exports = function (config) {
    return {
        basePath: './',
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
            { pattern: 'dist/tests-browser.js' },
            { pattern: 'src/analyzer/analyzer_wasm.wasm', included: false, watched: false, served: true },
            {
                pattern: DUCKDB_WASM,
                included: false,
                watched: false,
                served: true,
            },
            {
                pattern: DUCKDB_WORKER,
                included: false,
                watched: false,
                served: true,
            },
        ],
        preprocessors: {
            'src/**/*.js': ['sourcemap'],
            'test/**/*.js': ['sourcemap'],
        },
        proxies: {
            '/static/analyzer_wasm.wasm': '/base/src/analyzer/analyzer_wasm.wasm',
            '/static/duckdb.wasm': '/absolute' + path.resolve(DUCKDB_WASM),
            '/static/duckdb-browser-parallel.worker.js': '/absolute' + path.resolve(DUCKDB_WORKER),
        },
        exclude: [],
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
        specReporter: {
            maxLogLines: 5,
            suppressErrorSummary: true,
            suppressFailed: false,
            suppressPassed: false,
            suppressSkipped: true,
            showSpecTiming: true,
            failFast: true,
            prefixes: {
                success: '    OK: ',
                failure: 'FAILED: ',
                skipped: 'SKIPPED: ',
            },
        },
        coverageReporter: {
            type: 'json',
            dir: './coverage/',
            subdir: function (browser) {
                return browser.toLowerCase().split(/[ /-]/)[0];
            },
        },
        client: {
            jasmine: {
                failFast: true,
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
