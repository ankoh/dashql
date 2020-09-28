const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const withTranspileModules = require('next-transpile-modules')([
    // `monaco-editor` isn't published to npm correctly: it includes both CSS
    // imports and non-Node friendly syntax, so it needs to be compiled.
    'monaco-editor',
]);

module.exports = withTranspileModules({
    env: {
        PROJECT_ROOT: __dirname,
    },

    webpack: (config, { isServer }) => {
        if (isServer) {
            global.window = undefined;
            config.node = false;
        } else {
            config.node = {
                fs: 'empty',
            };
        }

        // Copy all wasm files
        config.module.rules.push({
            test: /\.wasm$/,
            type: 'javascript/auto',
            loader: 'file-loader',
            options: {
                publicPath: `/_next/static/wasm`,
                outputPath: 'static/wasm',
            },
        });

        // Copy all workers files
        config.module.rules.push({
            test: /worker\.js$/,
            type: 'javascript/auto',
            loader: 'file-loader',
            options: {
                publicPath: `/_next/static/workers`,
                outputPath: 'static/workers',
            },
        });

        // https://github.com/webpack-contrib/worker-loader/issues/166
        config.output.globalObject = 'this';

        // Find the global CSS loader
        const rule = config.module.rules
            .find(rule => rule.oneOf)
            .oneOf.find(
                r =>
                    r.issuer &&
                    r.issuer.include &&
                    r.issuer.include.includes('_app'),
            );
        if (rule) {
            rule.issuer.include = [
                rule.issuer.include,
                // Allow `monaco-editor` to import global CSS:
                /[\\/]node_modules[\\/]monaco-editor[\\/]/,
            ];
        }

        config.plugins.push(
            new MonacoWebpackPlugin({
                languages: ['sql'],
                filename: 'static/workers/[name].worker.js',
            }),
        );

        return config;
    },
});
