import { createAgentSessionState, type AgentSessionState } from '@ankoh/dashql/platform/session/agent_session_state';
import type { JournalFile, SessionWorkbook } from '@ankoh/dashql/platform/session/workbook_journal';
import type { Logger } from '@ankoh/dashql/platform/platform/logger/logger';

import { AgentSessionCopies, changedCopyScripts, type AgentSessionCopyHost } from './agent_session_copy.js';

const file = (path: string, mtimeMs: number): JournalFile => ({ path, size: 10, mtimeMs });

function copy(workbookId: string, files: JournalFile[], path = `.dashql/workbooks/${workbookId}`): SessionWorkbook {
    return { path, workbookId, files, results: [], running: null };
}

function state(...workbooks: SessionWorkbook[]): AgentSessionState {
    return { ...createAgentSessionState('claude', '/work'), workbooks };
}

const logger = { warn: () => { } } as unknown as Logger;

/// A workbook of the page with scripts, the files of the copies on the server
function host(files: Record<string, string>, scripts: Record<string, string>) {
    const page = new Map(Object.entries(scripts).map(([name, text], i) => [name, { scriptKey: i + 1, text }]));
    const rewrites: [number, string][] = [];
    const created: [string, string][] = [];
    const fake: AgentSessionCopyHost = {
        fetchText: async (_workbookId, path) => files[path],
        scripts: workbookId => workbookId === 'w1' ? new Map(page) : null,
        rewriteScript: (_workbookId, scriptKey, text) => {
            rewrites.push([scriptKey, text]);
            for (const [name, script] of page) if (script.scriptKey === scriptKey) page.set(name, { scriptKey, text });
        },
        createScript: (_workbookId, base, text) => {
            created.push([base, text]);
            const scriptKey = page.size + 1;
            // The workbook names the new script on its own
            page.set(`${base} 2.sql`, { scriptKey, text });
            return scriptKey;
        },
    };
    return { fake, rewrites, created };
}

describe('the copies of the workbooks of a page in a session', () => {
    it('finds the scripts that changed since the page saw the copy', () => {
        const seen = new Map([['dashql-workbook.json', '10:1'], ['scripts/a.sql', '10:1'], ['scripts/b.sql', '10:1']]);
        const next = copy('w1', [file('dashql-workbook.json', 2), file('scripts/a.sql', 1), file('scripts/b.sql', 2), file('scripts/c.sql', 2), file('attachments/t.parquet', 2)]);
        expect(changedCopyScripts(seen, next)).toEqual(['scripts/b.sql', 'scripts/c.sql']);
    });

    it('stages the scripts of the agent as rewrites and adds its new scripts', async () => {
        const files = { 'scripts/a.sql': 'select 1', 'scripts/b.sql': 'select 22', 'scripts/new.sql': 'select 3' };
        const { fake, rewrites, created } = host(files, { 'a.sql': 'select 1', 'b.sql': 'select 2' });
        const copies = new AgentSessionCopies(fake, logger);
        // The first state with the copy is what the page wrote
        await copies.update(state(copy('w1', [file('scripts/a.sql', 1), file('scripts/b.sql', 1)])));
        expect(rewrites).toEqual([]);

        // The agent changed b.sql and wrote new.sql; a.sql has a new stamp with the text of the page
        await copies.update(state(copy('w1', [file('scripts/a.sql', 2), file('scripts/b.sql', 2), file('scripts/new.sql', 2)])));
        expect(rewrites).toEqual([[2, 'select 22']]);
        expect(created).toEqual([['new', 'select 3']]);

        // The next change of new.sql goes to the script that the page created for it
        files['scripts/new.sql'] = 'select 33';
        await copies.update(state(copy('w1', [file('scripts/a.sql', 2), file('scripts/b.sql', 2), file('scripts/new.sql', 3)])));
        expect(rewrites).toEqual([[2, 'select 22'], [3, 'select 33']]);
        expect(created).toHaveLength(1);
    });

    it('leaves workbooks alone that are no copies of the page or that the page wrote again', async () => {
        const { fake, rewrites, created } = host({ 'scripts/a.sql': 'select 9' }, { 'a.sql': 'select 1' });
        const copies = new AgentSessionCopies(fake, logger);
        // A workbook folder of the agent elsewhere in the project, and the copy of a workbook that the page doesn't have
        await copies.update(state(copy('w1', [file('scripts/a.sql', 1)], 'orders'), copy('w2', [file('scripts/a.sql', 1)])));
        await copies.update(state(copy('w1', [file('scripts/a.sql', 2)], 'orders'), copy('w2', [file('scripts/a.sql', 2)])));
        expect(rewrites).toEqual([]);

        // The page writes its copy again, the next state is what it wrote
        await copies.update(state(copy('w1', [file('scripts/a.sql', 1)])));
        copies.reset('w1');
        await copies.update(state(copy('w1', [file('scripts/a.sql', 5)])));
        expect(rewrites).toEqual([]);
        expect(created).toEqual([]);
    });
});
