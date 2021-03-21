export enum ScriptURIPrefix {
    TMP,
    EXAMPLES,
    GITHUB_GIST,
    HTTP,
    HTTPS,
}

export interface Script {
    /// The program text
    text: string;
    /// The URI prefix
    uriPrefix: ScriptURIPrefix;
    /// The URI name
    uriName: string;
    /// Has been modified?
    modified: boolean;
    /// The line count
    lineCount?: number;
    /// The file size
    bytes?: number;
}

export function getScriptURIPrefixName(prefix: ScriptURIPrefix) {
    switch (prefix) {
        case ScriptURIPrefix.TMP: return "tmp";
        case ScriptURIPrefix.EXAMPLES: return "examples";
        case ScriptURIPrefix.GITHUB_GIST: return "gist";
        case ScriptURIPrefix.HTTP: return "http";
        case ScriptURIPrefix.HTTPS: return "https";
    }
}