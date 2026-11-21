import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { INIT_USAGE, runInit } from './init_command.js';
import { isWorkspace } from './session_folder.js';
import { runWith, testFiles } from './test_process.js';

const init = (cwd: string, args: string[]) => runWith(async (a, cli) => runInit(a, cli), cwd, args);

describe('dashql init', () => {
    it('sets up a folder as a workspace, this one or the named one', async () => {
        const dir = testFiles([]);
        expect(isWorkspace(dir)).toBe(false);
        expect(await init(dir, [])).toEqual({ code: 0, stdout: 'Set up the workspace .dashql/\n', stderr: '' });
        expect(isWorkspace(dir)).toBe(true);
        expect(readFileSync(path.join(dir, '.dashql', '.gitignore'), 'utf8')).toBe('*\n');
        expect(await init(dir, [])).toEqual({ code: 0, stdout: '.dashql/ is already set up\n', stderr: '' });
        expect((await init(dir, ['sub/project'])).stdout).toBe(`Set up the workspace ${path.join('sub/project', '.dashql')}/\n`);
        expect(isWorkspace(path.join(dir, 'sub', 'project'))).toBe(true);
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
