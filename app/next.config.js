module.exports = {
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

        return config;
    },
};
