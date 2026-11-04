import * as dashql from '@ankoh/dashql-core';

import { formatSqlText } from '../../session/scripts/script_format.js';

/// The name of the common table expression that holds the query of the script
const PROJECTION_INPUT = 'base';

/// Why a script cannot get the projection of its result
export enum ResultProjectionError {
    /// The script does not parse or has no statement
    NotParsed = 'not_parsed',
    /// The last statement of the script is no query
    NoQuery = 'no_query',
    /// The result has no columns
    NoColumns = 'no_columns',
    /// Two columns of the result have the same name, a projection cannot tell them apart
    DuplicateColumns = 'duplicate_columns',
}

/// Wrap the terminal query of a script, its last statement, into a common table expression and select every
/// column of its result below it: `with base as (<query>) select a, b from base`. A column is excluded by
/// deleting its line. The new statement is formatted with the pretty printer, the rest of the script stays.
/// Returns the new text of the script.
export function addResultProjection(
    core: dashql.DashQL,
    scriptText: string,
    columnNames: string[],
    config: dashql.buffers.formatting.FormattingConfigT,
): string | ResultProjectionError {
    if (columnNames.length === 0) return ResultProjectionError.NoColumns;
    if (new Set(columnNames).size !== columnNames.length) return ResultProjectionError.DuplicateColumns;

    // The span of the terminal query, in UTF-8 bytes
    const bytes = new TextEncoder().encode(scriptText);
    const catalog = core.createCatalog();
    const script = core.createScript(catalog);
    let span: { offset: number; length: number } | null = null;
    try {
        script.replaceText(scriptText);
        script.parse();
        const reader = script.getParsed().read();
        if (reader.scannerErrorsLength() > 0 || reader.parserErrorsLength() > 0 || reader.statementsLength() === 0) {
            return ResultProjectionError.NotParsed;
        }
        const statement = reader.statements(reader.statementsLength() - 1)!;
        if (statement.statementType() !== dashql.buffers.parser.StatementType.SELECT) {
            return ResultProjectionError.NoQuery;
        }
        const statementSpan = statement.statementSpan();
        if (statementSpan == null) return ResultProjectionError.NotParsed;
        span = { offset: statementSpan.offset(), length: statementSpan.length() };
    } finally {
        script.destroy();
        catalog.destroy();
    }

    const decoder = new TextDecoder();
    const before = decoder.decode(bytes.subarray(0, span.offset));
    const query = decoder.decode(bytes.subarray(span.offset, span.offset + span.length));
    const after = decoder.decode(bytes.subarray(span.offset + span.length));

    const input = core.quoteColumnName(PROJECTION_INPUT);
    const columns = columnNames.map(name => core.quoteColumnName(name));
    const projection = `with ${input} as (${query}) select ${columns.join(', ')} from ${input};`;
    // The separator of the statement stays in the text after it
    const formatted = formatSqlText(core, projection, config)?.trimEnd().replace(/;$/, '')
        ?? layoutProjection(input, query, columns);
    return `${before}${formatted}${after}`;
}

/// The projection when the formatter cannot format the query, the query keeps its text
function layoutProjection(input: string, query: string, columns: string[]): string {
    return `with ${input} as (
    ${query.split('\n').join('\n    ')}
)
select
    ${columns.join(',\n    ')}
from ${input}`;
}
