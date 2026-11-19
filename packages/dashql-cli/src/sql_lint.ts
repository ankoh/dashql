import type * as core from '@akohn/dashql';

/// A script to check: its id names it in the report, e.g. its path
export interface SqlInput {
    id: string;
    text: string;
}

/// The stage that reported a diagnostic, `failure` if the core failed to process the script
export type SqlDiagnosticStage = 'scan' | 'parse' | 'analyze' | 'failure';

export type SqlDiagnosticSeverity = 'error' | 'warning';

/// Where a diagnostic points into its script
export interface SqlLocation {
    /// The 1-based line
    line: number;
    /// The 1-based column, in code points
    column: number;
    /// The offset in the script, in UTF-8 bytes
    offset: number;
    /// The length in the script, in UTF-8 bytes
    length: number;
}

/// A finding of the core in a script
export interface SqlDiagnostic {
    stage: SqlDiagnosticStage;
    severity: SqlDiagnosticSeverity;
    message: string;
    /// Null for a failure
    location: SqlLocation | null;
}

/// The 1-based line and column of a UTF-8 byte offset into a text, the column counts code points
export function lineColumn(text: string, offset: number): [number, number] {
    const bytes = new TextEncoder().encode(text);
    let line = 1;
    let column = 1;
    for (let i = 0; i < Math.min(offset, bytes.length); ++i) {
        const byte = bytes[i];
        if (byte === 0x0a) {
            line += 1;
            column = 1;
        } else if ((byte & 0xc0) !== 0x80) {
            // Continuation bytes belong to the code point that was already counted
            column += 1;
        }
    }
    return [line, column];
}

/// The diagnostics of a script that the core processed
function diagnosticsOf(text: string, result: core.BatchScriptResult): SqlDiagnostic[] {
    const out: SqlDiagnostic[] = result.diagnostics.map(diagnostic => {
        const [line, column] = lineColumn(text, diagnostic.offset);
        return {
            stage: diagnostic.stage,
            severity: diagnostic.severity,
            message: diagnostic.message,
            location: { line, column, offset: diagnostic.offset, length: diagnostic.length },
        };
    });
    if (result.failure != null) {
        out.push({ stage: 'failure', severity: 'error', message: result.failure, location: null });
    }
    return out;
}

/// Scans, parses and analyzes scripts with the core, against the tables of schema scripts. Nothing runs.
export class SqlLinter {
    /// The catalogs of the schema scripts, an earlier schema wins on a conflict of names
    protected readonly schemas: Uint8Array[] = [];

    constructor(protected readonly core: core.DashQL) {}

    /// Add a schema script, e.g. CREATE TABLE statements, that later scripts resolve their names against. Returns the
    /// diagnostics of the schema itself, a schema with errors is not added.
    addSchema(input: SqlInput): SqlDiagnostic[] {
        const [result] = this.core.processBatch({
            scripts: [{ id: input.id, text: input.text, outputs: ['catalogDescriptor'] }],
            catalogDescriptors: this.schemas,
        }).scripts;
        const diagnostics = diagnosticsOf(input.text, result);
        if (!diagnostics.some(diagnostic => diagnostic.severity === 'error') && result.catalogDescriptor != null) {
            this.schemas.push(result.catalogDescriptor);
        }
        return diagnostics;
    }

    /// The diagnostics of a script against the schemas
    lint(input: SqlInput): SqlDiagnostic[] {
        const [result] = this.core.processBatch({
            // The core reports the diagnostics of the stages that produce the requested outputs
            scripts: [{ id: input.id, text: input.text, outputs: ['analyzed'] }],
            catalogDescriptors: this.schemas,
        }).scripts;
        return diagnosticsOf(input.text, result);
    }
}
