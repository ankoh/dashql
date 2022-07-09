export function parse(text) {
    if (typeof globalThis.DASHQL_PARSER === 'undefined' || typeof globalThis.DASHQL_PARSER.parse !== 'function') {
        console.error('DASHQL_PARSER not initialized');
        // throw new Error('DASHQL_PARSER not initialized');
    }
    return globalThis.DASHQL_PARSER.parse(text);
}
