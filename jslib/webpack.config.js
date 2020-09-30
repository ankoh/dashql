// webpack.config.js
const path = require('path')

module.exports = {
    mode: 'production',

    entry: {
        "duckdb": './src/index.ts',
        "duckdb.worker": './src/index.worker.ts'
    },

    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        library: 'DuckDB',
        libraryTarget: 'umd',
        umdNamedDefine: true,
        globalObject: 'this'
    },

    resolve: {
        extensions: ['.ts', '.js']
    },

    module: {
        rules: [{
            test: /\\.ts$/,
            include: path.resolve(__dirname, 'src'),
            exclude: /node_modules/,
            use: 'ts-loader'
        }, {
            test: /\.wasm$/,
            type: 'javascript/auto',
            loader: 'file-loader',
            options: {
                name: '[hash].[ext]',
            }
        }]
    }
}
