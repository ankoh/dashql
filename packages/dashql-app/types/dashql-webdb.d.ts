declare module '@dashql/webdb-wasm' {
    const value: any;
    export default value;
}

declare module '@dashql/webdb-wasm-js' {
    function createWebDBModule(options?: any): Promise<any>;
    export default createWebDBModule;
}
