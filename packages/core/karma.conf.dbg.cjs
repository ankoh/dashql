const path = require('path');

const JS_TIMEOUT = 900000;

module.exports = function (config) {
    config.set({
        basePath: './',
        plugins: [
            'karma-jasmine',
            'karma-chrome-launcher',
            'karma-firefox-launcher',
            'karma-sourcemap-loader',
            'karma-jasmine-html-reporter',
        ],
        frameworks: ['jasmine'],
        files: [
            { pattern: 'dist/tests-browser.js' },
            { pattern: 'src/analyzer/analyzer_wasm.wasm', included: false, watched: false, served: true },
            { pattern: '../duckdb/dist/duckdb.wasm', included: false, watched: false, served: true },
            {
                pattern: '../duckdb/dist/duckdb-browser-parallel.worker.js',
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
            '/static/duckdb.wasm': '/absolute' + path.resolve('../duckdb/dist/duckdb.wasm'),
            '/static/duckdb-browser-parallel.worker.js':
                '/absolute' + path.resolve('../duckdb/dist/duckdb-browser-parallel.worker.js'),
        },
        exclude: [],
        reporters: ['kjhtml'],
        port: 9876,
        colors: true,
        logLevel: config.LOG_INFO,
        autoWatch: true,
        singleRun: true,
        browsers: [],
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
    });
};
