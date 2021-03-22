const path = require('path');
const os = require('os');
const fs = require('fs');
const puppeteer = require('puppeteer');

process.env.CHROME_BIN = puppeteer.executablePath();

module.exports = function(config) {
    config.set({
        basePath: '../..',
        frameworks: ['jasmine'],
        files: [
            { pattern: 'packages/webdb/dist/tests-browser.js' },
            { pattern: 'packages/webdb/dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'packages/webdb/dist/*.js', included: false, watched: false, served: true },
            { pattern: 'data/uni/out/*.parquet', included: false, watched: false, served: true },
        ],
        proxies: {
            '/static/webdb.wasm': '/base/packages/webdb/dist/webdb.wasm',
            '/static/webdb-async.worker.js': '/base/packages/webdb/dist/webdb-async.worker.js',
            '/data/': '/base/data/uni/out/',
        },
        exclude: [],
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