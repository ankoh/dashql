declare module '*.wasm' {
    const value: any;
    export default value;
}

declare module '*.module.css' {
    const content: {[className: string]: string};
    export default content;
}

declare module "monaco-editor/esm/vs/editor/editor.worker.js" {
    const content: any;
    export = content;
}
