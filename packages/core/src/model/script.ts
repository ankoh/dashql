// Copyright (c) 2021 The DashQL Authors

export enum ScriptOriginType {
    LOCAL,
    EXAMPLES,
    GITHUB_GIST,
    HTTP,
    HTTPS,
}

export interface ScriptOrigin {
    /// The origin type
    originType: ScriptOriginType;
    /// The filename
    fileName: string;
    /// The example name
    exampleName?: string;
    /// The raw http url
    httpURL?: URL;
    /// The github account
    githubAccount?: string;
    /// The github gist name
    githubGistName?: string;
}

export interface Script {
    /// The origin
    origin: ScriptOrigin;
    /// The description
    description: string;
    /// The program text
    text: string;
    /// Has been modified?
    modified: boolean;
    /// The line count
    lineCount?: number;
    /// The file size
    bytes?: number;
}

export function getScriptNamespace(script: Script): string | null {
    switch (script.origin.originType) {
        case ScriptOriginType.LOCAL:
            return '#';
        case ScriptOriginType.EXAMPLES:
            return '#';
        case ScriptOriginType.GITHUB_GIST:
            return script.origin.githubAccount;
        default:
            return null;
    }
}

export function getScriptName(script: Script): string | null {
    switch (script.origin.originType) {
        case ScriptOriginType.HTTP:
        case ScriptOriginType.HTTPS: {
            const filename = script.origin.httpURL.pathname.split('/').pop();
            return filename || null;
        }
        case ScriptOriginType.LOCAL:
            return script.origin.fileName;
        case ScriptOriginType.GITHUB_GIST:
            return script.origin.githubGistName;
        case ScriptOriginType.EXAMPLES:
            return script.origin.exampleName;
    }
}

export function getScriptOriginTypeName(prefix: ScriptOriginType): string {
    switch (prefix) {
        case ScriptOriginType.LOCAL:
            return 'local';
        case ScriptOriginType.EXAMPLES:
            return 'examples';
        case ScriptOriginType.GITHUB_GIST:
            return 'gist';
        case ScriptOriginType.HTTP:
            return 'http';
        case ScriptOriginType.HTTPS:
            return 'https';
    }
}
