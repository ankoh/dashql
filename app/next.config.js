const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const withTranspileModules = require('next-transpile-modules')([
    // `monaco-editor` isn't published to npm correctly: it includes both CSS
    // imports and non-Node friendly syntax, so it needs to be compiled.
    'monaco-editor',
]);

module.exports = withTranspileModules({
    webpack: (config, { isServer }) => {
        if (isServer) {
            global.window = undefined;

            config.node = false;
        } else {
            config.node = {
                fs: 'empty',
            };
        }

        config.module.rules.push({
            test: /\.wasm$/,
            type: 'javascript/auto',
            loader: 'file-loader',
            options: {
                publicPath: `/_next/static/wasm`,
                outputPath: 'static/wasm',
            },
        });

        const rule = config.module.rules
            .find(rule => rule.oneOf)
            .oneOf.find(
                r =>
                    // Find the global CSS loader
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
                filename: 'static/[name].worker.js',
            }),
        );

        return config;
    },
});
