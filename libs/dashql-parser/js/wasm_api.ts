export module parser {
    export function parseScript(mod: any, text: string) {
        const ast = mod.parser_parse_script(text);
        return new Uint8Array(ast);
    }
}
