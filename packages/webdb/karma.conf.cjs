const path = require('path');
const os = require('os');
const fs = require('fs');
const puppeteer = require('puppeteer');

process.env.CHROME_BIN = puppeteer.executablePath();

module.exports = function (config) {
    config.set({
        basePath: './',
        frameworks: ['jasmine'],
        files: [
            { pattern: 'dist/tests-browser.js' },
            { pattern: 'dist/*.wasm', included: false, watched: false, served: true },
            { pattern: 'dist/*.js', included: false, watched: false, served: true },
        ],
        proxies: {
            '/static/webdb.wasm': '/base/dist/webdb.wasm',
            '/static/webdb-browser-parallel.worker.js': '/base/dist/webdb-browser-parallel.worker.js',
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
