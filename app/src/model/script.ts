// Copyright (c) 2021 The DashQL Authors

export interface Script {
    metadata: ScriptMetadata;
    text: string;
    textLineCount: number;
    textBytes: number;
    /// Has been modified?
    modified?: boolean;
}

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

export interface ScriptMetadata {
    /// The origin
    origin: ScriptOrigin;
    /// The description
    description: string;
    /// Is modified?
    modified?: boolean;
}

export function getScriptNamespace(script: ScriptMetadata): string | null {
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

export function getScriptName(script: ScriptMetadata): string | null {
    switch (script.origin.originType) {
        case ScriptOriginType.HTTP:
        case ScriptOriginType.HTTPS: {
            const filename = script.origin.httpURL.pathname.split('/').pop();
            return filename || null;
        }
        case ScriptOriginType.LOCAL:
            return script.origin.fileName;
        case ScriptOriginType.GITHUB_GIST:
            return script.origin.fileName;
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

export function getScriptBeans(script: ScriptMetadata): string[] {
    const beans = [];
    switch (script.origin.originType) {
        case ScriptOriginType.LOCAL:
            beans.push('Local');
            break;
        case ScriptOriginType.EXAMPLES:
            beans.push('Example');
            break;
        case ScriptOriginType.GITHUB_GIST:
            beans.push('Gist');
            break;
    }
    return beans;
}

export function scriptSupportsStats(script: ScriptMetadata): boolean {
    return (
        script.origin.originType == ScriptOriginType.GITHUB_GIST ||
        script.origin.originType == ScriptOriginType.EXAMPLES
    );
}

export function canEditScript(script: ScriptMetadata): boolean {
    return (
        script.origin.originType == ScriptOriginType.LOCAL || script.origin.originType == ScriptOriginType.GITHUB_GIST
    );
}
