import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { INIT_USAGE, runInit } from './init_command.js';
import { isWorkspace, workbookCopyOf } from './session_folder.js';
import { runWith, testFiles } from './test_process.js';

const init = (cwd: string, args: string[]) => runWith(async (a, cli) => runInit(a, cli), cwd, args);

describe('dashql init', () => {
    it('sets up a folder as a workspace, the .dashql/ of this one or the named one', async () => {
        const dir = testFiles([]);
        const workspace = path.join(dir, '.dashql');
        expect(isWorkspace(workspace)).toBe(false);
        expect(await init(dir, [])).toEqual({ code: 0, stdout: 'Set up the workspace .dashql/\n', stderr: '' });
        expect(isWorkspace(workspace)).toBe(true);
        expect(isWorkspace(dir)).toBe(false);
        expect(readFileSync(path.join(workspace, '.gitignore'), 'utf8')).toBe('*\n');
        expect(await init(dir, [])).toEqual({ code: 0, stdout: '.dashql/ is already set up\n', stderr: '' });
        // A named folder is the workspace itself, with no .dashql/ inside
        expect((await init(dir, ['sub/state'])).stdout).toBe(`Set up the workspace ${path.join('sub', 'state')}/\n`);
        expect(isWorkspace(path.join(dir, 'sub', 'state'))).toBe(true);
        expect(readdirSync(path.join(dir, 'sub', 'state'))).toEqual(expect.arrayContaining(['.gitignore', 'dashql-workspace.json']));
        expect(JSON.parse(readFileSync(path.join(dir, 'sub', 'state', 'dashql-workspace.json'), 'utf8'))).toEqual({ formatVersion: 1 });
    });

    it('sets up only a new or empty folder', async () => {
        const dir = testFiles(['README.md']);
        const project = await init(dir, ['.']);
        expect(project.code).toBe(2);
        expect(project.stderr).toContain('is no workspace');
        expect(existsSync(path.join(dir, '.gitignore'))).toBe(false);
        expect(existsSync(path.join(dir, 'dashql-workspace.json'))).toBe(false);
        mkdirSync(path.join(dir, 'empty'));
        expect((await init(dir, ['empty'])).code).toBe(0);
        expect(isWorkspace(path.join(dir, 'empty'))).toBe(true);
    });

    it('gives a workspace from before the workspace file one, with its files', async () => {
        // The .dashql/ of a run or a session of an older dashql, its .gitignore ignores all of it
        const dir = testFiles([['.dashql/.gitignore', '*\n'], '.dashql/cache/k.parquet']);
        expect(isWorkspace(path.join(dir, '.dashql'))).toBe(false);
        expect(await init(dir, [])).toEqual({ code: 0, stdout: 'Set up the workspace .dashql/\n', stderr: '' });
        expect(isWorkspace(path.join(dir, '.dashql'))).toBe(true);
        expect(existsSync(path.join(dir, '.dashql', 'cache', 'k.parquet'))).toBe(true);
    });

    it('checks its arguments', async () => {
        const dir = testFiles([]);
        expect((await init(dir, ['--help'])).stdout).toBe(`${INIT_USAGE}\n`);
        const two = await init(dir, ['a', 'b']);
        expect(two.code).toBe(2);
        expect(two.stderr).toBe(`error: unexpected argument b\n\n${INIT_USAGE}\n`);
        expect(existsSync(path.join(dir, 'a'))).toBe(false);
    });
});

describe('a workspace', () => {
    it('is a folder with a workspace file, not the folder around it', () => {
        expect(isWorkspace(testFiles([['dashql-workspace.json', '{"formatVersion":1}']]))).toBe(true);
        expect(isWorkspace(testFiles([['dashql-workspace.json', '{}']]))).toBe(false);
        expect(isWorkspace(testFiles([['.gitignore', '*\n']]))).toBe(false);
        expect(isWorkspace(testFiles([['.dashql/dashql-workspace.json', '{"formatVersion":1}']]))).toBe(false);
    });

    it('knows the copies of the workbooks of the tab in its session, under any name', () => {
        const dir = testFiles([['state/dashql-workspace.json', '{"formatVersion":1}'], 'state/workbooks/w1/dashql-workbook.json', 'other/workbooks/w1/dashql-workbook.json']);
        const copy = path.join(dir, 'state', 'workbooks', 'w1');
        expect(workbookCopyOf(copy)).toEqual({ workspace: path.join(dir, 'state'), workbookId: 'w1' });
        // No workspace around it
        expect(workbookCopyOf(path.join(dir, 'other', 'workbooks', 'w1'))).toBeNull();
    });
});
