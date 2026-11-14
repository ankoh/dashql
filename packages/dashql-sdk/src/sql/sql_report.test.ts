import { formatDuration, formatReportFile, formatReportSummary, formatReportTimings, ReportColor, ReportStyle } from './sql_report.js';
import type { SqlDiagnostic } from './sql_lint.js';

const PLAIN = new ReportStyle(false);

const parseError: SqlDiagnostic = {
    stage: 'parse',
    severity: 'error',
    message: 'syntax error, unexpected SEMICOLON',
    location: { line: 2, column: 11, offset: 20, length: 1 },
};

describe('the report of the SQL linter', () => {
    it('shows a diagnostic with the underlined source line', () => {
        expect(formatReportFile('q.sql', 'select 1;\nselect 1 +;\n', [parseError], PLAIN)).toBe([
            'q.sql',
            '  2:11  error    parse    syntax error, unexpected SEMICOLON',
            '        │ select 1 +;',
            '        │           ^',
        ].join('\n'));
    });

    it('underlines the whole span in code points', () => {
        const diagnostic: SqlDiagnostic = {
            stage: 'analyze',
            severity: 'warning',
            message: 'hm',
            location: { line: 1, column: 14, offset: 14, length: 5 },
        };
        const out = formatReportFile('q.sql', "select 'ä' + bogus;", [diagnostic], PLAIN);
        expect(out.split('\n').slice(2)).toEqual(["        │ select 'ä' + bogus;", '        │              ^^^^^']);
    });

    it('indents messages of several lines and failures', () => {
        const failure: SqlDiagnostic = { stage: 'failure', severity: 'error', message: 'boom\nmore', location: null };
        expect(formatReportFile('q.sql', '', [failure], PLAIN)).toBe(['q.sql', '    error    failure  boom', '                      more'].join('\n'));
    });

    it('styles without changing the text', () => {
        const style = new ReportStyle(true);
        expect(style.apply(ReportColor.Red, 'x')).toBe('\x1b[31mx\x1b[39m');
        expect(style.apply(ReportColor.Bold, 'x')).toBe('\x1b[1mx\x1b[22m');
    });

    it('counts files, errors and warnings', () => {
        expect(formatReportSummary(1, 0, 2, PLAIN)).toBe('1 file, 0 errors, 2 warnings');
        expect(formatReportSummary(3, 1, 0, PLAIN)).toBe('3 files, 1 error, 0 warnings');
    });

    it('formats durations', () => {
        expect(formatDuration(0.4)).toBe('0 ms');
        expect(formatDuration(999)).toBe('999 ms');
        expect(formatDuration(1260)).toBe('1.3 s');
        expect(formatReportTimings(42, PLAIN)).toBe('dashql-core  scan, parse and analyze 42 ms');
    });
});
