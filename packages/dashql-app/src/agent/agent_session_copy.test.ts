import { createAgentSessionState, type AgentSessionState } from '@ankoh/dashql/platform/session/agent_session_state';
import type { JournalFile, SessionWorkbook } from '@ankoh/dashql/platform/session/workbook_journal';
import type { Logger } from '@ankoh/dashql/platform/platform/logger/logger';

import { AgentSessionCopies, changedCopyScripts, type AgentSessionCopyHost, type PageScript } from './agent_session_copy.js';

const logger = { info: () => { }, warn: () => { } } as unknown as Logger;

/// A page with the workbook w1 and the server of a session with its copy
class Fixture {
    /// The scripts of the page by file name
    readonly page = new Map<string, PageScript>();
    /// The files of the copy on the server by path, with the time of their last write
    readonly copy = new Map<string, { text: string; mtimeMs: number }>();
    readonly rewrites: [number, string][] = [];
    readonly created: [string, string][] = [];
    readonly writes: string[] = [];
    readonly imported: string[] = [];
    /// The results of the runs of the agent on the copy
    results: SessionWorkbook['results'] = [];
    private listeners = new Set<() => void>();
    private clock = 1;
    private nextKey = 1;

    constructor(scripts: Record<string, string>) {
        for (const [name, text] of Object.entries(scripts)) this.page.set(name, { scriptKey: this.nextKey++, text });
    }

    /// The user edits a script of the page
    edit(name: string, text: string | null): void {
        if (text == null) this.page.delete(name);
        else this.page.set(name, { scriptKey: this.page.get(name)?.scriptKey ?? this.nextKey++, text });
        for (const listener of this.listeners) listener();
    }

    /// The agent writes a file of the copy
    agentWrites(path: string, text: string): void {
        this.copy.set(path, { text, mtimeMs: ++this.clock });
    }

    /// The state of the session that names the copy
    state(): AgentSessionState {
        const files: JournalFile[] = [...this.copy].map(([path, file]) => ({ path, size: file.text.length, mtimeMs: file.mtimeMs }));
        return { ...createAgentSessionState('claude', '/work'), workbooks: [{ path: '.dashql/workbooks/w1', workbookId: 'w1', files, results: this.results, running: null }] };
    }

    readonly host: AgentSessionCopyHost = {
        readFolder: async workbookId => workbookId !== 'w1' ? null : [
            { path: 'dashql-workbook.json', content: '{}' },
            ...[...this.page].map(([name, script]) => ({ path: `scripts/${name}`, content: script.text })),
        ],
        readWorkbookFile: async () => `{"scripts":${JSON.stringify([...this.page.keys()])}}`,
        writeCopy: async (_workbookId, files) => {
            this.copy.clear();
            for (const file of files) this.copy.set(file.path, { text: String(file.content), mtimeMs: ++this.clock });
        },
        writeFile: async (_workbookId, path, text) => {
            this.writes.push(path);
            this.copy.set(path, { text, mtimeMs: ++this.clock });
        },
        deleteFile: async (_workbookId, path) => {
            this.writes.push(`-${path}`);
            this.copy.delete(path);
        },
        fetchText: async (_workbookId, path) => this.copy.get(path)!.text,
        scripts: workbookId => workbookId === 'w1' ? new Map(this.page) : null,
        subscribe: (_workbookId, listener) => {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        },
        rewriteScript: (_workbookId, scriptKey, text) => {
            this.rewrites.push([scriptKey, text]);
            for (const [name, script] of this.page) if (script.scriptKey === scriptKey) this.page.set(name, { scriptKey, text });
        },
        createScript: (_workbookId, base, text) => {
            this.created.push([base, text]);
            const scriptKey = this.nextKey++;
            this.page.set(`${base}.sql`, { scriptKey, text });
            return scriptKey;
        },
        importResult: async key => {
            this.imported.push(key);
            return true;
        },
        delay: async () => { },
    };
}

/// Let the scheduled pushes run
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the copies of the workbooks of a page in a session', () => {
    it('finds the scripts that changed since the page saw the copy', () => {
        const seen = new Map([['dashql-workbook.json', '10:1'], ['scripts/a.sql', '10:1'], ['scripts/b.sql', '10:1']]);
        const file = (path: string, mtimeMs: number): JournalFile => ({ path, size: 10, mtimeMs });
        const next: SessionWorkbook = {
            path: '.dashql/workbooks/w1', workbookId: 'w1', results: [], running: null,
            files: [file('dashql-workbook.json', 2), file('scripts/a.sql', 1), file('scripts/b.sql', 2), file('scripts/c.sql', 2), file('attachments/t.parquet', 2)],
        };
        expect(changedCopyScripts(seen, next)).toEqual(['scripts/b.sql', 'scripts/c.sql']);
    });

    it('stages the scripts of the agent as rewrites and adds its new scripts', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        expect([...fixture.copy.keys()]).toEqual(['dashql-workbook.json', 'scripts/a.sql', 'scripts/b.sql']);
        // The first state with the copy is what the page wrote
        await copies.update(fixture.state());
        expect(fixture.rewrites).toEqual([]);

        // The agent changed b.sql and wrote new.sql; a.sql has a new stamp with the text of the page
        fixture.agentWrites('scripts/a.sql', 'select 1');
        fixture.agentWrites('scripts/b.sql', 'select 22');
        fixture.agentWrites('scripts/new.sql', 'select 3');
        await copies.update(fixture.state());
        expect(fixture.rewrites).toEqual([[2, 'select 22']]);
        expect(fixture.created).toEqual([['new', 'select 3']]);
        // What the page took from the agent goes not back into the copy
        await tick();
        await copies.settled();
        expect(fixture.writes).toEqual([]);
    });

    it('writes the scripts that the user changes into the copy', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await copies.update(fixture.state());

        fixture.edit('a.sql', 'select 11');
        fixture.edit('c.sql', 'select 3');
        fixture.edit('b.sql', null);
        await tick();
        await copies.settled();
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 11');
        expect(fixture.copy.get('scripts/c.sql')?.text).toBe('select 3');
        expect(fixture.copy.has('scripts/b.sql')).toBe(false);
        // A new or deleted script changes the list of the workbook file
        expect(fixture.copy.get('dashql-workbook.json')?.text).toBe('{"scripts":["a.sql","c.sql"]}');

        // The stamps of its own writes bring no rewrites
        await copies.update(fixture.state());
        expect(fixture.rewrites).toEqual([]);

        // A rejected rewrite of the agent goes back into the copy
        fixture.agentWrites('scripts/a.sql', 'select 12');
        await copies.update(fixture.state());
        expect(fixture.rewrites).toEqual([[1, 'select 12']]);
        fixture.edit('a.sql', 'select 11');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 11');

        // An ended session takes no edits
        copies.dispose();
        fixture.edit('a.sql', 'select 13');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 11');
    });

    it('takes what the agent did while the page reloaded', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2' });
        await fixture.host.writeCopy('w1', (await fixture.host.readFolder('w1'))!);
        fixture.agentWrites('scripts/b.sql', 'select 22');

        // The reloaded page follows the copy that it wrote before, it writes nothing until it knows the copy
        const copies = new AgentSessionCopies(fixture.host, logger);
        copies.adopt('w1');
        expect(copies.has('w1')).toBe(true);
        await copies.update(fixture.state());
        expect(fixture.rewrites).toEqual([[2, 'select 22']]);
        await tick();
        await copies.settled();
        expect(fixture.writes).toEqual([]);
        // From then on the edits of the user go into the copy
        fixture.edit('a.sql', 'select 11');
        await tick();
        await copies.settled();
        expect(fixture.writes).toEqual(['scripts/a.sql']);
        expect(fixture.copy.get('scripts/b.sql')?.text).toBe('select 22');
    });

    it('takes the results of the runs of the agent into the query result cache once', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        const key = 'a'.repeat(64);
        fixture.results = [
            { script: 'a.sql', key, rows: 1, error: null, cached: false },
            { script: 'b.sql', key: null, rows: null, error: 'failed', cached: false },
            { script: 'c.sql', key: 'not-a-key', rows: 1, error: null, cached: false },
        ];
        await copies.update(fixture.state());
        await copies.update(fixture.state());
        expect(fixture.imported).toEqual([key]);
    });

    it('copies nothing of a workbook without a folder in OPFS and leaves other workbook folders alone', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('native');
        expect(copies.has('native')).toBe(true);
        expect(fixture.copy.size).toBe(0);
        // A workbook folder of the agent elsewhere in the project
        const state = fixture.state();
        await copies.update({ ...state, workbooks: [{ ...state.workbooks[0], path: 'orders' }] });
        expect(fixture.rewrites).toEqual([]);
    });
});
