import { parseArguments, parseSettingValue, UsageError } from './args.js';

function usageError(argv: string[]): string {
    try {
        parseArguments(argv);
    } catch (e) {
        if (e instanceof UsageError) return e.message;
        throw e;
    }
    throw new Error(`expected a usage error for ${argv.join(' ')}`);
}

describe('parseArguments', () => {
    it('reads --help and --version, also without a command', () => {
        expect(parseArguments([])).toEqual({ command: 'help' });
        expect(parseArguments(['--help'])).toEqual({ command: 'help' });
        expect(parseArguments(['-h'])).toEqual({ command: 'help' });
        expect(parseArguments(['--version'])).toEqual({ command: 'version' });
        expect(parseArguments(['run', '--help'])).toEqual({ command: 'help' });
    });

    it('reads describe with and without a topic', () => {
        expect(parseArguments(['describe'])).toEqual({ command: 'describe', topic: null });
        expect(parseArguments(['describe', 'files'])).toEqual({ command: 'describe', topic: 'files' });
    });

    it('refuses two topics', () => {
        expect(usageError(['describe', 'files', 'catalog'])).toMatch(/one topic/);
    });

    it('reads run with SQL and the defaults', () => {
        expect(parseArguments(['run', '-c', 'select 1'])).toEqual({
            command: 'run',
            database: null,
            format: 'table',
            maxRows: 20,
            settings: {},
            source: { kind: 'command', sql: 'select 1' },
        });
        expect(parseArguments(['run', '--command', 'select 1'])).toMatchObject({ source: { kind: 'command', sql: 'select 1' } });
    });

    it('reads the SQL of a file and of stdin', () => {
        expect(parseArguments(['run', '-f', 'q.sql'])).toMatchObject({ source: { kind: 'file', path: 'q.sql' } });
        expect(parseArguments(['run', '--file', 'q.sql'])).toMatchObject({ source: { kind: 'file', path: 'q.sql' } });
        expect(parseArguments(['run', '-f', '-'])).toMatchObject({ source: { kind: 'stdin' } });
        expect(parseArguments(['run', '-'])).toMatchObject({ source: { kind: 'stdin' } });
    });

    it('reads the options of run', () => {
        expect(
            parseArguments([
                'run',
                '--db',
                'sales.hyper',
                '--format',
                'json',
                '--max-rows',
                '0',
                '--setting',
                'log_file_max_count=2',
                '--setting',
                'identifier_resolution=case_insensitive',
                '-c',
                'select 1',
            ]),
        ).toEqual({
            command: 'run',
            database: 'sales.hyper',
            format: 'json',
            maxRows: 0,
            settings: { log_file_max_count: 2, identifier_resolution: 'case_insensitive' },
            source: { kind: 'command', sql: 'select 1' },
        });
    });

    it('needs exactly one source of SQL', () => {
        expect(usageError(['run'])).toMatch(/-c, -f or -/);
        expect(usageError(['run', '-c', 'select 1', '-f', 'q.sql'])).toMatch(/only one/);
        expect(usageError(['run', '-c', 'select 1', '-'])).toMatch(/only one/);
    });

    it('refuses an unknown command, option or format', () => {
        expect(usageError(['query', '-c', 'select 1'])).toMatch(/unknown command 'query'/);
        expect(usageError(['run', '--sql', 'select 1'])).toMatch(/--sql/);
        expect(usageError(['run', '--format', 'xml', '-c', 'select 1'])).toMatch(/table, json or csv/);
        expect(usageError(['run', '-c', 'select 1', 'extra'])).toMatch(/extra/);
    });

    it('refuses --max-rows that is not a whole number of zero or more', () => {
        for (const value of ['-1', '1.5', 'many', '']) {
            expect(usageError(['run', '--max-rows', value, '-c', 'select 1'])).toMatch(/--max-rows/);
        }
    });

    it('refuses a setting without a name or a value', () => {
        expect(usageError(['run', '--setting', 'novalue', '-c', 'select 1'])).toMatch(/NAME=VALUE/);
        expect(usageError(['run', '--setting', '=1', '-c', 'select 1'])).toMatch(/NAME=VALUE/);
    });

    it('refuses an option that run does not take for describe', () => {
        expect(usageError(['describe', '--db', 'x.hyper'])).toMatch(/--db/);
    });
});

describe('parseSettingValue', () => {
    it('reads booleans, whole numbers and texts', () => {
        expect(parseSettingValue('true')).toBe(true);
        expect(parseSettingValue('false')).toBe(false);
        expect(parseSettingValue('42')).toBe(42);
        expect(parseSettingValue('-3')).toBe(-3);
        expect(parseSettingValue('1M')).toBe('1M');
        expect(parseSettingValue('1.5')).toBe('1.5');
        expect(parseSettingValue('')).toBe('');
    });
});
