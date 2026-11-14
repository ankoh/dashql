import { LINT_USAGE, parseLintArgs, runLint } from './lint_command.js';
import { runWith, testFiles } from './test_process.js';

const lint = (cwd: string, args: string[], stdin = '') => runWith(runLint, cwd, args, stdin);

const SCHEMA = 'create table orders (id integer);\n';
const QUERY = 'select id from orders, items;\n';

describe('dashql lint', () => {
    it('parses options and paths', () => {
        expect(parseLintArgs(['--schema', 's.sql', 'a.sql', '--schema=t.sql', '-', '--debug', '--', '--odd.sql'])).toEqual({
            schemas: ['s.sql', 't.sql'],
            paths: ['a.sql', '-', '--odd.sql'],
            debug: true,
            help: false,
        });
        expect(() => parseLintArgs(['--schema'])).toThrow('option --schema needs a file');
        expect(() => parseLintArgs(['--bogus'])).toThrow('unknown option --bogus');
        expect(parseLintArgs(['-h']).help).toBe(true);
        expect(parseLintArgs(['--help']).help).toBe(true);
    });

    it('passes a clean script and prints only the summary', async () => {
        const output = await lint(testFiles([['a.sql', 'select 1;\n']]), ['a.sql']);
        expect(output).toEqual({ code: 0, stdout: '1 file, 0 errors, 0 warnings\n', stderr: '' });
    });

    it('fails with exit code 1 and shows the error in its line', async () => {
        const output = await lint(testFiles([['a.sql', 'select 1;\nselect 1 +;\n']]), ['a.sql']);
        expect(output).toEqual({
            code: 1,
            stdout: 'a.sql\n  2:11  error    parse    syntax error, unexpected SEMICOLON\n        │ select 1 +;\n        │           ^\n\n1 file, 1 error, 0 warnings\n',
            stderr: '',
        });
    });

    it('passes with warnings alone and shows them', async () => {
        const output = await lint(testFiles([['a.sql', '/* @vis vegalite */\nselect 1 as value;\n']]), ['a.sql']);
        expect(output.code).toBe(0);
        expect(output.stdout.startsWith('a.sql\n')).toBe(true);
        expect(output.stdout).toContain('warning  analyze  @vis vegalite needs a Vega-Lite spec');
        expect(output.stdout.endsWith('1 file, 0 errors, 1 warning\n')).toBe(true);
    });

    it('prints only the scripts with diagnostics and counts all of them', async () => {
        const output = await lint(testFiles([['bad1.sql', 'select 1 +;\n'], ['good.sql', 'select 1;\n'], ['bad2.sql', 'select 2 +;\n']]), ['.']);
        expect(output.code).toBe(1);
        expect(output.stdout).toContain('bad1.sql\n');
        expect(output.stdout).toContain('bad2.sql\n');
        expect(output.stdout).not.toContain('good.sql');
        expect(output.stdout.endsWith('3 files, 2 errors, 0 warnings\n')).toBe(true);
        expect((await lint(testFiles([['notes.txt', '']]), ['.'])).stdout).toBe('0 files, 0 errors, 0 warnings\n');
    });

    it('reads a script from stdin', async () => {
        const output = await lint(testFiles([]), ['-'], 'select 1 +;\n');
        expect(output.code).toBe(1);
        expect(output.stdout.startsWith('<stdin>\n')).toBe(true);
        expect(output.stdout).toContain('select 1 +;');
    });

    it('resolves names only against the schemas', async () => {
        const root = testFiles([['schema.sql', `${SCHEMA}create table items (id integer);\n`], ['q.sql', QUERY], ['orders.sql', SCHEMA]]);
        // id is ambiguous once both tables are known
        const ambiguous = await lint(root, ['--schema', 'schema.sql', 'q.sql']);
        expect(ambiguous.code).toBe(1);
        expect(ambiguous.stdout.startsWith('q.sql\n')).toBe(true);
        // With one of them, the column is not ambiguous
        expect((await lint(root, ['--schema', 'orders.sql', 'q.sql'])).stdout).not.toContain('ambiguous');
    });

    it('shows the timings with --debug', async () => {
        const output = await lint(testFiles([['a.sql', 'select 1;\n']]), ['--debug', 'a.sql']);
        expect(output.stdout).toMatch(/^dashql-core  scan, parse and analyze \d+ ms\n\n1 file/);
    });

    it('rejects bad command lines', async () => {
        const root = testFiles([]);
        for (const args of [[], ['--bogus', 'a.sql'], ['--schema']]) {
            const output = await lint(root, args);
            expect(output.code, args.join(' ')).toBe(2);
            expect(output.stderr.endsWith(`${LINT_USAGE}\n`)).toBe(true);
        }
        const missing = await lint(root, ['gone.sql']);
        expect(missing.code).toBe(2);
        expect(missing.stderr).toContain('gone.sql');
        expect((await lint(root, ['--help'])).stdout).toBe(`${LINT_USAGE}\n`);
    });
});
