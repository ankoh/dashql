const path = require('path');

module.exports = {
    mode: 'production',
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'tigon-proto.js',
        library: 'tigon-proto',
        libraryTarget: 'umd',
    },
    performance: {
        maxEntrypointSize: 512000,
        maxAssetSize: 512000
    }
};
