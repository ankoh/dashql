declare module '@dashql/duckdb-wasm' {
    const value: any;
    export default value;
}

declare module '@dashql/duckdb-wasm-js' {
    function createWebDBModule(options?: any): Promise<any>;
    export default createWebDBModule;
}
