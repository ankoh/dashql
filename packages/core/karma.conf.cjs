const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.CHROME_BIN = require('puppeteer').executablePath();

module.exports = function (config) {
    config.set({
        basePath: './',
        frameworks: ['jasmine'],
        files: [
            { pattern: 'dist/tests-browser.js' },
            { pattern: 'src/analyzer/analyzer_wasm.wasm', included: false, watched: false, served: true },
            { pattern: '../webdb/dist/webdb.wasm', included: false, watched: false, served: true },
            {
                pattern: '../webdb/dist/webdb-browser-parallel.worker.js',
                included: false,
                watched: false,
                served: true,
            },
        ],
        proxies: {
            '/static/analyzer_wasm.wasm': '/base/src/analyzer/analyzer_wasm.wasm',
            '/static/webdb.wasm': '/absolute' + path.resolve('../webdb/dist/webdb.wasm'),
            '/static/webdb-browser-parallel.worker.js':
                '/absolute' + path.resolve('../webdb/dist/webdb-browser-parallel.worker.js'),
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
    });
};
