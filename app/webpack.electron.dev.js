import { configure, GITHUB_OAUTH_VERSION } from './webpack.common.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, './dist/electron');

const base = configure({
    buildDir,
    tsLoaderOptions: {
        compilerOptions: {
            configFile: './tsconfig.json',
            sourceMap: true,
        },
    },
    extractCss: false,
    cssIdentifier: '[local]_[hash:base64]',
    dashqlAPP: 'http://localhost:9001',
    dashqlAPI: 'https://api-worker-dev.dashql.workers.dev',
    githubOAuthClientID: '877379132b93adf6f705',
    githubOAuthRedirect: `http://localhost:9001/static/html/github_oauth.${GITHUB_OAUTH_VERSION}.html`,
});

const renderer = {
    ...base,
    target: 'electron-renderer',
    output: {
        ...base.output,
        publicPath: './',
        devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]', // map to source with absolute file path not webpack:// protocol
    },
    mode: 'development',
    watchOptions: {
        ignored: ['node_modules/**', 'dist/**'],
    },
    performance: {
        hints: false,
    },
    devtool: 'source-map',
};

const main = {
    ...renderer,
    target: 'electron-main',
    entry: {
        electron: ['./src/targets/electron.ts'],
    },
    output: {
        ...renderer.output,
        publicPath: './',
        filename: '[name].cjs',
    },
    plugins: [],
};

export default [renderer, main];
