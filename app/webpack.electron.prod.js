import { configure, GITHUB_OAUTH_VERSION } from './webpack.common.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, './dist/electron');
const buildDirRenderer = path.join(buildDir, 'app');

const base = configure({
    buildDir,
    tsLoaderOptions: {
        compilerOptions: {
            configFile: './tsconfig.json',
            sourceMap: false,
        },
    },
    extractCss: true,
    cssIdentifier: '[hash:base64]',
    dashqlAPP: 'https://app.dashql.com',
    dashqlAPI: 'https://api.dashql.com',
    githubOAuthClientID: '286d19fc45d2e4e826d6',
    githubOAuthCallback: `https://api.dashql.com/static/html/github_oauth.${GITHUB_OAUTH_VERSION}.html`,
});

const renderer = {
    ...base,
    target: 'electron-renderer',
    output: {
        ...base.output,
        path: buildDirRenderer,
        publicPath: './',
    },
    mode: 'production',
    devtool: false,
};

const main = {
    ...renderer,
    target: 'electron-main',
    entry: {
        electron: ['./src/targets/electron.ts'],
    },
    output: {
        ...base.output,
        path: buildDir,
        publicPath: './',
        filename: '[name].cjs',
        chunkFilename: 'js/[name].[contenthash].cjs',
        assetModuleFilename: 'assets/[name].[contenthash][ext]',
        globalObject: 'globalThis',
        clean: {
            keep: /app\//,
        },
    },
    plugins: [],
};

export default [renderer, main];
