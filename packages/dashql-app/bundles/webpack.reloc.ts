import webpack from 'webpack';
import * as webpackDevServer from 'webpack-dev-server';
import * as path from 'path';

import { configure } from './webpack.common';

// chdir = . (repo root) so node_modules at root is on the resolution path; app dir from env.
const _appDir = process.env.DASHQL_APP_DIR ? path.join(process.cwd(), process.env.DASHQL_APP_DIR) : process.cwd();

export type Configuration = webpack.Configuration & {
    devServer?: webpackDevServer.Configuration;
};

const base = configure({
    mode: 'production',
    target: 'web',
    buildDir: path.join(_appDir, 'build', 'reloc'),
    relocatable: true,
    extractCss: true,
    cssIdentifier: '[hash:base64]',
    appURL: process.env.DASHQL_APP_URL ?? 'https://dashql.app',
    logLevel: process.env.DASHQL_LOG_LEVEL ?? 'info',
});

const config: Configuration = {
    ...base,
    devtool: false,
};

export default config;
