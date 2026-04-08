declare module '@dashql/duckdb-wasm' {
    const value: any;
    export default value;
}

declare module '@dashql/duckdb-wasm-js' {
    function createDuckDBModule(options?: any): Promise<any>;
    export default createDuckDBModule;
}
