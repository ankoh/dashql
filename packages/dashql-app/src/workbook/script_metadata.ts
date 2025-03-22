export enum ScriptOriginType {
    FILE,
    LOCAL,
    HTTP,
}

export enum ScriptType {
    UNKNOWN,
    QUERY,
    SCHEMA,
}

export interface ScriptAnnotations {
    /// The foundations tables
    tableRefs?: Set<string>;
    /// The query_result definitions
    tableDefs?: Set<string>;
    /// The tenant name (if any)
    tenantName?: string;
    /// The org name (if any)
    orgName?: string;
}

export interface ScriptMetadata {
    /// The script type
    scriptType: ScriptType;
    /// The origin type
    originType: ScriptOriginType;
    /// The script id
    originalScriptName: string | null;
    /// The schema id
    originalSchemaName: string | null;
    /// The http url
    originalHttpURL: URL | null;
    /// The statistics
    annotations: ScriptAnnotations | null;
    /// Is the script immutable?
    immutable: boolean;
}

export function generateBlankScriptMetadata(): ScriptMetadata {
    return {
        originalSchemaName: null,
        originalScriptName: null,
        scriptType: ScriptType.UNKNOWN,
        originType: ScriptOriginType.LOCAL,
        originalHttpURL: null,
        annotations: null,
        immutable: false,
    };
}

export function getScriptOriginTypeName(origin: ScriptOriginType): string {
    switch (origin) {
        case ScriptOriginType.LOCAL:
            return 'local';
        case ScriptOriginType.HTTP:
            return 'http';
        case ScriptOriginType.FILE:
            return 'file';
    }
}

export function getScriptTags(script: ScriptMetadata): string[] {
    const beans = [];
    switch (script.originType) {
        case ScriptOriginType.LOCAL:
            beans.push('Local');
            break;
    }
    return beans;
}
