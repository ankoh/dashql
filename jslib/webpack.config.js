// webpack.config.js
const path = require('path')

module.exports = {
    mode: 'production',

    entry: {
        "duckdb": './src/duckdb.ts',
        "duckdb.worker": './src/duckdb.worker.ts'
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
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: [
                    /node_modules/,
                    path.resolve(__dirname, 'test')
                ],
            },
            {
                test: /\.wasm$/,
                type: 'javascript/auto',
                loader: 'file-loader',
                options: {
                    name: '[hash].[ext]',
                }
            }
        ]
    }
}
