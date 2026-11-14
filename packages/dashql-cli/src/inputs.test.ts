import { chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readInputs } from './inputs.js';
import { testFiles } from './test_process.js';

const read = (cwd: string, paths: string[], stdin: Uint8Array | string = '') =>
    readInputs(paths, cwd, () => Promise.resolve(typeof stdin === 'string' ? new TextEncoder().encode(stdin) : stdin));
const ids = async (inputs: Promise<{ id: string }[]>) => (await inputs).map(input => input.id);

describe('the inputs of dashql', () => {
    it('names scripts relative to the invoking directory', async () => {
        const root = testFiles(['work/a.sql', 'work/sub/b.sql', 'outside/c.sql']);
        const inputs = await read(path.join(root, 'work'), ['a.sql', './sub/b.sql', '../outside/c.sql']);
        expect(inputs.map(input => input.id)).toEqual(['a.sql', 'sub/b.sql', path.join(root, 'outside/c.sql')]);
        expect(inputs[0].text).toBe('work/a.sql');
        expect(inputs[1].text).toBe('work/sub/b.sql');
    });

    it('reads absolute paths and names them relative when they are inside', async () => {
        const root = testFiles(['a.sql']);
        expect(await ids(read(root, [path.join(root, 'a.sql')]))).toEqual(['a.sql']);
    });

    it('reads every script once', async () => {
        const root = testFiles(['a.sql', 'sub/b.sql']);
        expect(await ids(read(root, ['a.sql', './a.sql', path.join(root, 'a.sql'), 'sub/../a.sql', '.', 'sub', 'sub/b.sql']))).toEqual(['a.sql', 'sub/b.sql']);
    });

    it('keeps the order of the arguments', async () => {
        const root = testFiles(['a.sql', 'b.sql', 'sub/c.sql']);
        expect(await ids(read(root, ['sub', 'b.sql', 'a.sql']))).toEqual(['sub/c.sql', 'b.sql', 'a.sql']);
    });

    it('walks the SQL files in the order of their names without generated, hidden and package folders', async () => {
        const root = testFiles(['b.sql', 'a.SQL', 'notes.txt', 'dashql-relations.sql', 'dashql-catalog-relations.sql',
            'dashql-catalog-changes.sql', 'sub/c.sql', '.hidden/d.sql', 'node_modules/e.sql']);
        expect(await ids(read(root, ['.']))).toEqual(['a.SQL', 'b.sql', 'sub/c.sql']);
    });

    it('reads named files of any kind but filters directories', async () => {
        const root = testFiles(['notes.txt', 'dashql-relations.sql', 'a.sql']);
        expect(await ids(read(root, ['notes.txt', 'dashql-relations.sql']))).toEqual(['notes.txt', 'dashql-relations.sql']);
        expect(await ids(read(root, ['.']))).toEqual(['a.sql']);
        expect(await read(testFiles(['notes.txt']), ['.'])).toEqual([]);
    });

    it('reads stdin once', async () => {
        const root = testFiles(['a.sql']);
        const inputs = await read(root, ['-', 'a.sql', '-'], 'select 1;');
        expect(inputs.map(input => input.id)).toEqual(['<stdin>', 'a.sql']);
        expect(inputs[0].text).toBe('select 1;');
    });

    it('replaces invalid UTF-8', async () => {
        const root = testFiles([['a.sql', new Uint8Array([...new TextEncoder().encode("select '"), 0xff, ...new TextEncoder().encode("';")])]]);
        const inputs = await read(root, ['a.sql', '-'], new Uint8Array([...new TextEncoder().encode("select '"), 0xfe, ...new TextEncoder().encode("';")]));
        expect(inputs.map(input => input.text)).toEqual(["select '\u{fffd}';", "select '\u{fffd}';"]);
    });

    it('fails when stdin fails and names a missing path', async () => {
        const root = testFiles([]);
        await expect(readInputs(['-'], root, () => Promise.reject(new Error('closed')))).rejects.toBe('stdin: closed');
        await expect(read(root, ['missing.sql'])).rejects.toMatch(new RegExp(`^${path.join(root, 'missing.sql')}: `));
    });

    it('follows symlinks to directories and files and skips dangling ones', async () => {
        const root = testFiles(['library/b.sql', 'work/a.sql', 'other.sql']);
        symlinkSync(path.join(root, 'library'), path.join(root, 'work/linked'));
        symlinkSync(path.join(root, 'other.sql'), path.join(root, 'work/other.sql'));
        symlinkSync(path.join(root, 'gone.sql'), path.join(root, 'work/dangling.sql'));
        expect(await ids(read(path.join(root, 'work'), ['.']))).toEqual(['a.sql', 'linked/b.sql', 'other.sql']);
        await expect(read(path.join(root, 'work'), ['dangling.sql'])).rejects.toBeDefined();
    });

    it('reads a directory with links back to itself and its ancestors once', async () => {
        const root = testFiles(['a.sql', 'sub/b.sql']);
        symlinkSync(root, path.join(root, 'loop'));
        // Without a guard the walk doubles on every level until the kernel gives up after 40 links
        symlinkSync(root, path.join(root, 'sub/up1'));
        symlinkSync(root, path.join(root, 'sub/up2'));
        expect(await ids(read(root, ['.']))).toEqual(['a.sql', 'sub/b.sql']);
    });

    it('walks a directory that two links share', async () => {
        const root = testFiles(['library/b.sql', 'work/x/keep', 'work/y/keep']);
        symlinkSync(path.join(root, 'library'), path.join(root, 'work/x/lib'));
        symlinkSync(path.join(root, 'library'), path.join(root, 'work/y/lib'));
        expect(await ids(read(path.join(root, 'work'), ['.']))).toEqual(['x/lib/b.sql', 'y/lib/b.sql']);
    });

    it('fails on files and directories that cannot be read', async () => {
        // Root reads everything
        if (process.getuid?.() === 0) return;
        const root = testFiles(['a.sql', 'locked/b.sql']);
        chmodSync(path.join(root, 'a.sql'), 0o000);
        await expect(read(root, ['a.sql'])).rejects.toMatch(new RegExp(`^${path.join(root, 'a.sql')}: `));
        chmodSync(path.join(root, 'a.sql'), 0o644);
        chmodSync(path.join(root, 'locked'), 0o000);
        await expect(read(root, ['.'])).rejects.toBeDefined();
        chmodSync(path.join(root, 'locked'), 0o755);
        writeFileSync(path.join(root, 'locked/b.sql'), 'select 1;');
    });
});
