const { configure } = require('./webpack.common.js');
const path = require('path');

module.exports = {
    ...configure({
        buildDir: path.resolve(__dirname, './build/debug'),
        tsLoaderOptions: {
            compilerOptions: {
                configFile: './tsconfig.json',
                sourceMap: true,
            }
        },
        extractCss: false,
        cssIdentifier: '[local]_[hash:base64]'
    }),
    mode: 'development',
    watchOptions: {
        ignored: [
            'node_modules/**',
            'dist/**',
        ]
    }
    performance: {
        hints: false
    },
    devtool: 'source-map',
    devServer: {
        historyApiFallback: true,
        contentBase: path.join(__dirname, './build/debug'),
        compress: true,
        port: 9000,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
            // This will enable SharedArrayBuffers in Firefox but will block most requests to third-party sites.
            //
            // "Cross-Origin-Resource-Policy": "cross-origin",
            // "Cross-Origin-Embedder-Policy": "require-corp",
            // "Cross-Origin-Opener-Policy": "same-origin"
        }
    }
}
