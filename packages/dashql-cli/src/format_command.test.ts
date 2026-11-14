import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FORMAT_USAGE, runFormat } from './format_command.js';
import { runWith, testFiles } from './test_process.js';

const format = (cwd: string, args: string[], stdin = '') => runWith(runFormat, cwd, args, stdin);
const text = (root: string, name: string) => readFileSync(path.join(root, name), 'utf8');

describe('dashql format', () => {
    it('prints a script and leaves the file', async () => {
        const root = testFiles([['a.sql', 'SELECT  1']]);
        expect(await format(root, ['a.sql'])).toEqual({ code: 0, stdout: 'select 1;\n', stderr: '' });
        expect(text(root, 'a.sql')).toBe('SELECT  1');
    });

    it('formats a script from stdin', async () => {
        expect(await format('/', ['-'], 'CALL t.f(a=>1)')).toMatchObject({ code: 0, stdout: 'call t.f (a => 1);\n' });
    });

    it('formats in the dialect of the scripts', async () => {
        const script = 'select cast(a as array(integer));\n';
        expect(await format('/', ['-'], script)).toMatchObject({ code: 0, stdout: 'select cast(a as integer[]);\n' });
        const trino = await format('/', ['--dialect', 'trino', '-'], script);
        expect(trino).toMatchObject({ code: 0, stdout: 'select cast(a as array(integer));\n' });
        expect((await format('/', ['--dialect=trino', '-'], script)).stdout).toBe(trino.stdout);
    });

    it('writes only the files that change', async () => {
        const root = testFiles([['a.sql', 'SELECT  1'], ['b.sql', 'select 1;\n']]);
        expect(await format(root, ['--write', '.'])).toMatchObject({ code: 0, stdout: 'a.sql\n2 files, 1 rewritten, 0 failed\n' });
        expect(text(root, 'a.sql')).toBe('select 1;\n');
    });

    it('checks without writing', async () => {
        const root = testFiles([['a.sql', 'SELECT  1'], ['b.sql', 'select 1;\n']]);
        expect(await format(root, ['--check', '.'])).toMatchObject({ code: 1, stdout: 'a.sql\n2 files, 1 not formatted, 0 failed\n' });
        expect(text(root, 'a.sql')).toBe('SELECT  1');
        expect((await format(root, ['--check', 'b.sql'])).code).toBe(0);
    });

    it('keeps a script with errors and formats the others', async () => {
        const root = testFiles([['a.sql', 'select 1 +;\n'], ['b.sql', 'SELECT  1']]);
        const output = await format(root, ['--write', '.']);
        expect(output.code).toBe(1);
        expect(output.stderr.startsWith('a.sql: syntax error')).toBe(true);
        expect(text(root, 'a.sql')).toBe('select 1 +;\n');
        expect(text(root, 'b.sql')).toBe('select 1;\n');
    });

    it('keeps a script the formatter cannot print', async () => {
        const root = testFiles([['a.sql', 'select somefunc(default);\n']]);
        const output = await format(root, ['--write', 'a.sql']);
        expect(output.code).toBe(1);
        expect(output.stderr).toBe("a.sql: the formatter doesn't know all of the script\n");
        expect(text(root, 'a.sql')).toBe('select somefunc(default);\n');
    });

    it('rejects bad command lines', async () => {
        const root = testFiles([]);
        for (const args of [[], ['--bogus', 'a.sql'], ['--write', '--check', 'a.sql'], ['--write', '-'], ['--dialect', 'x', 'a.sql'], ['a.sql', '--dialect']]) {
            const output = await format(root, args);
            expect(output.code, args.join(' ')).toBe(2);
            expect(output.stderr.endsWith(`${FORMAT_USAGE}\n`), args.join(' ')).toBe(true);
        }
        expect((await format(root, ['gone.sql'])).code).toBe(2);
        expect((await format(root, ['--help'])).stdout).toBe(`${FORMAT_USAGE}\n`);
    });
});
