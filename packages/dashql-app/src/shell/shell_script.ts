import type * as dashql from '@ankoh/dashql-core';

function terminateStatement(text: string): string {
    return text.endsWith(';') ? text : `${text};`;
}

/// Split SQL into its statements, keeping SQL that does not parse as a single statement
function splitSql(core: dashql.DashQL, catalog: dashql.DashQLCatalog, sql: string, out: string[]) {
    const trimmed = sql.trim();
    if (trimmed.length === 0) return;

    const bytes = new TextEncoder().encode(sql);
    const decoder = new TextDecoder();
    const script = core.createScript(catalog);
    let parsed: dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null = null;
    try {
        script.replaceText(sql);
        script.parse();
        parsed = script.getParsed();
        const reader = parsed.read();
        if (reader.scannerErrorsLength() > 0 || reader.parserErrorsLength() > 0 || reader.statementsLength() === 0) {
            out.push(terminateStatement(trimmed));
            return;
        }
        for (let i = 0; i < reader.statementsLength(); ++i) {
            const span = reader.statements(i)!.statementSpan();
            if (!span) continue;
            const text = decoder.decode(bytes.subarray(span.offset(), span.offset() + span.length())).trim();
            if (text.length > 0) out.push(terminateStatement(text));
        }
    } finally {
        parsed?.destroy();
        script.destroy();
    }
}

/// Split a script into the prompts the shell offers one after another, e.g. a shared script or a snippet.
/// Lines starting with a dot are shell commands, everything between them is SQL.
export function splitShellScript(core: dashql.DashQL, catalog: dashql.DashQLCatalog, script: string): string[] {
    const out: string[] = [];
    let sql: string[] = [];
    for (const line of script.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('.')) {
            splitSql(core, catalog, sql.join('\n'), out);
            sql = [];
            out.push(trimmed);
        } else {
            sql.push(line);
        }
    }
    splitSql(core, catalog, sql.join('\n'), out);
    return out;
}
