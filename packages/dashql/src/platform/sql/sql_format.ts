import * as core from '../../core/index.js';

/// The line width of formatted scripts
export const SQL_FORMAT_MAX_WIDTH = 120;
/// The indentation of formatted scripts, the one of the app
export const SQL_FORMAT_INDENTATION = 4;

export type SqlFormatResult = { formatted: string } | { error: string };

/// The first error of the scanner or the parser in a text, null without one
function syntaxError(dql: core.DashQL, text: string): string | null {
    // The core reports the diagnostics of the stages that produce the requested outputs
    const [result] = dql.processBatch({ scripts: [{ id: 'format', text, outputs: ['parsed'] }] }).scripts;
    if (result.failure != null) return result.failure;
    const error = result.diagnostics.find(diagnostic => diagnostic.severity === 'error' && diagnostic.stage !== 'analyze');
    return error?.message ?? null;
}

/// Pretty print a script with lowercase keywords, with a line break at its end. A script with errors isn't formatted,
/// and neither is one that the formatter can't print completely or whose output doesn't parse: the output would
/// replace the script.
export function formatSqlScript(dql: core.DashQL, text: string, dialect: core.buffers.formatting.FormattingDialect): SqlFormatResult {
    const error = syntaxError(dql, text);
    if (error != null) return { error };
    const config = new core.buffers.formatting.FormattingConfigT(
        dialect,
        core.buffers.formatting.FormattingMode.PRETTY,
        SQL_FORMAT_MAX_WIDTH,
        SQL_FORMAT_INDENTATION,
        false,
        core.buffers.formatting.KeywordCase.LOWER,
    );
    const catalog = dql.createCatalog();
    const script = dql.createScript(catalog);
    try {
        script.replaceText(text);
        if (!script.isFullyFormattable(config)) return { error: "the formatter doesn't know all of the script" };
        const formatted = script.format(config);
        let output: string;
        try {
            output = formatted.toString();
        } finally {
            formatted.destroy();
        }
        if (syntaxError(dql, output) != null) return { error: "the formatted script doesn't parse" };
        return { formatted: `${output.trimEnd()}\n` };
    } finally {
        script.destroy();
        catalog.destroy();
    }
}
