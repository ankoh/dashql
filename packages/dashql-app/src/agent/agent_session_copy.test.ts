import { createAgentSessionState, type AgentSessionState } from '@akohn/dashql/platform/session/agent_session_state';
import type { CopyFile, SessionWorkbook } from '@akohn/dashql/platform/session/session_folder';
import type { Logger } from '@akohn/dashql/platform/logger/logger';

import { AgentSessionCopies, catalogRelationsPath, changedCopyScripts, copyScriptConnections, copyScriptOrder, type AgentSessionCopyHost, type CopyCatalog, type PageScript } from './agent_session_copy.js';

const logger = { info: () => { }, warn: () => { } } as unknown as Logger;

/// A page with the workbook w1 and the server of a session with its copy
class Fixture {
    /// The scripts of the page by file name
    readonly page = new Map<string, PageScript>();
    /// The files of the copy on the server by path, with the time of their last write
    readonly copy = new Map<string, { text: string; mtimeMs: number }>();
    /// The texts that the page took from the agent
    readonly taken: [number, string][] = [];
    readonly created: [string, string, string | null, number | null][] = [];
    readonly moved: [number, string][] = [];
    readonly writes: string[] = [];
    /// The catalogs of the connections that the agent may use
    readonly catalogs = new Map<string, CopyCatalog>();
    /// The paths whose next write fails
    readonly failingWrites = new Set<string>();
    private listeners = new Set<() => void>();
    private clock = 1;
    private nextKey = 1;

    constructor(scripts: Record<string, string>) {
        for (const [name, text] of Object.entries(scripts)) this.page.set(name, { scriptKey: this.nextKey++, text, connectionId: 'c1' });
    }

    /// The user edits a script of the page
    edit(name: string, text: string | null): void {
        if (text == null) this.page.delete(name);
        else this.page.set(name, { scriptKey: this.page.get(name)?.scriptKey ?? this.nextKey++, text, connectionId: this.page.get(name)?.connectionId ?? 'c1' });
        for (const listener of this.listeners) listener();
    }

    /// The order of the scripts of the page, the ones that the order leaves out follow like in the runtime
    reorder(order: string[]): void {
        const before = [...this.page.keys()];
        const names = [...new Set([...order.filter(name => this.page.has(name)), ...before])];
        // The same order changes nothing, like in the runtime
        if (names.every((name, index) => name === before[index])) return;
        this.place(names, new Map(this.page));
        for (const listener of this.listeners) listener();
    }

    private place(names: string[], scripts: Map<string, PageScript>): void {
        this.page.clear();
        for (const name of names) this.page.set(name, scripts.get(name)!);
    }

    /// The key of a script of the page
    keyOf(name: string): number {
        return this.page.get(name)!.scriptKey;
    }

    /// The agent writes a file of the copy
    agentWrites(path: string, text: string): void {
        this.copy.set(path, { text, mtimeMs: ++this.clock });
    }

    /// The state of the session that names the copy
    state(): AgentSessionState {
        const files: CopyFile[] = [...this.copy].map(([path, file]) => ({ path, size: file.text.length, mtimeMs: file.mtimeMs }));
        return { ...createAgentSessionState('claude', '/work', 's1'), workbooks: [{ workbookId: 'w1', files }] };
    }

    readonly host: AgentSessionCopyHost = {
        readFolder: async workbookId => workbookId !== 'w1' ? null : [
            { path: 'dashql-workbook.json', content: '{}' },
            ...[...this.page].map(([name, script]) => ({ path: `scripts/${name}`, content: script.text })),
        ],
        readWorkbookFile: async () => JSON.stringify({ scripts: [...this.page].map(([name, script]) => ({ name, connectionId: script.connectionId })) }),
        writeCopy: async (_workbookId, files) => {
            this.copy.clear();
            for (const file of files) this.copy.set(file.path, { text: String(file.content), mtimeMs: ++this.clock });
        },
        writeFile: async (_workbookId, path, text) => {
            if (this.failingWrites.delete(path)) throw new Error(`cannot write ${path}`);
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
        setScriptText: (_workbookId, scriptKey, text) => {
            this.taken.push([scriptKey, text]);
            for (const [name, script] of this.page) if (script.scriptKey === scriptKey) this.page.set(name, { ...script, text });
        },
        createScript: (_workbookId, base, text, connectionId, index) => {
            this.created.push([base, text, connectionId, index]);
            const scriptKey = this.nextKey++;
            const names = [...this.page.keys()];
            names.splice(index ?? names.length, 0, `${base}.sql`);
            this.place(names, new Map(this.page).set(`${base}.sql`, { scriptKey, text, connectionId: connectionId ?? 'c1' }));
            return scriptKey;
        },
        setScriptConnection: (_workbookId, scriptKey, connectionId) => {
            if (connectionId === 'unknown') return false;
            this.moved.push([scriptKey, connectionId]);
            for (const [name, script] of this.page) if (script.scriptKey === scriptKey) this.page.set(name, { ...script, connectionId });
            return true;
        },
        reorderScripts: (_workbookId, order) => this.reorder(order),
        catalogs: () => new Map(this.catalogs),
        delay: async () => { },
    };
}

/// Let the scheduled pushes run
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the copies of the workbooks of a page in a session', () => {
    it('finds the scripts that changed since the page saw the copy', () => {
        const seen = new Map([['dashql-workbook.json', '10:1'], ['scripts/a.sql', '10:1'], ['scripts/b.sql', '10:1']]);
        const file = (path: string, mtimeMs: number): CopyFile => ({ path, size: 10, mtimeMs });
        const next: SessionWorkbook = {
            workbookId: 'w1',
            files: [file('dashql-workbook.json', 2), file('scripts/a.sql', 1), file('scripts/b.sql', 2), file('scripts/c.sql', 2), file('attachments/t.parquet', 2)],
        };
        expect(changedCopyScripts(seen, next)).toEqual(['scripts/b.sql', 'scripts/c.sql']);
    });

    it('takes the scripts of the agent with their text and adds its new scripts', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        expect([...fixture.copy.keys()]).toEqual(['dashql-workbook.json', 'scripts/a.sql', 'scripts/b.sql']);
        // The first state with the copy is what the page wrote
        await copies.update(fixture.state());
        expect(fixture.taken).toEqual([]);

        // The agent changed b.sql and wrote new.sql; a.sql has a new stamp with the text of the page
        fixture.agentWrites('scripts/a.sql', 'select 1');
        fixture.agentWrites('scripts/b.sql', 'select 22');
        fixture.agentWrites('scripts/new.sql', 'select 3');
        await copies.update(fixture.state());
        expect(fixture.taken).toEqual([[fixture.keyOf('b.sql'), 'select 22']]);
        expect(fixture.created).toEqual([['new', 'select 3', null, null]]);
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
        expect(copyScriptOrder(fixture.copy.get('dashql-workbook.json')!.text)).toEqual(['a.sql', 'c.sql']);

        // The stamps of its own writes take nothing
        await copies.update(fixture.state());
        expect(fixture.taken).toEqual([]);

        // The user changes a text that the page took from the agent, the change goes into the copy
        fixture.agentWrites('scripts/a.sql', 'select 12');
        await copies.update(fixture.state());
        expect(fixture.taken).toEqual([[fixture.keyOf('a.sql'), 'select 12']]);
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

    it('writes a change of the user again when its write failed', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await copies.update(fixture.state());

        fixture.failingWrites.add('scripts/a.sql');
        fixture.edit('a.sql', 'select 11');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 1');

        // The next push writes it, a later change of the agent then doesn't replace the text of the user unseen
        fixture.edit('b.sql', 'select 22');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 11');
        expect(fixture.copy.get('scripts/b.sql')?.text).toBe('select 22');
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
        expect(fixture.taken).toEqual([[fixture.keyOf('b.sql'), 'select 22']]);
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

    it('writes the catalogs of the connections of the agent into the copy when they change', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1' });
        fixture.catalogs.set('c1', { stamp: '1', text: () => 'CREATE TABLE t (a integer);\n' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('connections/c1/dashql-catalog-relations.sql')?.text).toBe('CREATE TABLE t (a integer);\n');
        expect(catalogRelationsPath('c1')).toBe('connections/c1/dashql-catalog-relations.sql');

        // An edit writes no catalog that did not change, a catalog with a new stamp is written again
        fixture.edit('a.sql', 'select 11');
        await tick();
        await copies.settled();
        expect([...fixture.writes].sort()).toEqual(['connections/c1/dashql-catalog-relations.sql', 'scripts/a.sql']);
        fixture.catalogs.set('c1', { stamp: '2', text: () => 'CREATE TABLE t (a integer, b text);\n' });
        fixture.catalogs.set('hyper', { stamp: '1', text: () => '' });
        fixture.edit('a.sql', 'select 12');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('connections/c1/dashql-catalog-relations.sql')?.text).toBe('CREATE TABLE t (a integer, b text);\n');
        expect(fixture.copy.has('connections/hyper/dashql-catalog-relations.sql')).toBe(true);
    });

    it('puts the scripts of the agent on the connections that the workbook file of the copy names', async () => {
        expect(copyScriptConnections('{"scripts":[{"name":"a.sql","connectionId":"c1"},{"name":"b.sql"},"c.sql"]}')).toEqual(new Map([['a.sql', 'c1']]));
        expect(copyScriptConnections('{"scr')).toEqual(new Map());

        const fixture = new Fixture({ 'a.sql': 'select 1' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await copies.update(fixture.state());
        // The agent names the connection of a new script before it writes the script
        fixture.agentWrites('dashql-workbook.json', JSON.stringify({ scripts: [{ name: 'a.sql', connectionId: 'c1' }, { name: 'top.sql', connectionId: 'hyper' }] }));
        fixture.agentWrites('scripts/top.sql', 'select * from :a');
        await copies.update(fixture.state());
        expect(fixture.created).toEqual([['top', 'select * from :a', 'hyper', 1]]);
        expect(fixture.page.get('top.sql')?.connectionId).toBe('hyper');

        // The agent moves a script to another connection, one that the page doesn't have stays where it is
        fixture.agentWrites('dashql-workbook.json', JSON.stringify({ scripts: [{ name: 'a.sql', connectionId: 'hyper' }, { name: 'top.sql', connectionId: 'unknown' }] }));
        await copies.update(fixture.state());
        expect(fixture.moved).toEqual([[fixture.keyOf('a.sql'), 'hyper']]);
        expect(fixture.page.get('top.sql')?.connectionId).toBe('hyper');
    });

    it('takes the order of the workbook file of the copy and writes the order of the page into it', async () => {
        expect(copyScriptOrder('{"scripts":[{"name":"b.sql"},{"name":"a.sql","connectionId":"c1"},"c.sql"]}')).toEqual(['b.sql', 'a.sql']);
        expect(copyScriptOrder('{"scr')).toEqual([]);

        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2', 'c.sql': 'select 3' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await copies.update(fixture.state());
        // The agent moves c before a, the feed follows
        fixture.agentWrites('dashql-workbook.json', JSON.stringify({ scripts: [{ name: 'c.sql' }, { name: 'a.sql' }, { name: 'b.sql' }] }));
        await copies.update(fixture.state());
        expect([...fixture.page.keys()]).toEqual(['c.sql', 'a.sql', 'b.sql']);
        // The scripts that the file leaves out follow
        fixture.agentWrites('dashql-workbook.json', JSON.stringify({ scripts: [{ name: 'b.sql' }, { name: 'c.sql' }] }));
        await copies.update(fixture.state());
        expect([...fixture.page.keys()]).toEqual(['b.sql', 'c.sql', 'a.sql']);
        await tick();
        await copies.settled();
        // A new script goes where the file lists it
        fixture.agentWrites('dashql-workbook.json', JSON.stringify({ scripts: [{ name: 'b.sql' }, { name: 'new.sql' }, { name: 'c.sql' }, { name: 'a.sql' }] }));
        fixture.agentWrites('scripts/new.sql', 'select 4');
        await copies.update(fixture.state());
        expect(fixture.created).toEqual([['new', 'select 4', null, 1]]);
        expect([...fixture.page.keys()]).toEqual(['b.sql', 'new.sql', 'c.sql', 'a.sql']);
        await tick();
        await copies.settled();
        // The user moves a script in the feed, the workbook file of the copy follows although no script is new
        fixture.writes.length = 0;
        fixture.reorder(['a.sql', 'b.sql', 'c.sql']);
        await tick();
        await copies.settled();
        expect(fixture.writes).toEqual(['dashql-workbook.json']);
        expect(copyScriptOrder(fixture.copy.get('dashql-workbook.json')!.text)).toEqual(['a.sql', 'b.sql', 'c.sql', 'new.sql']);
    });

    it('holds the changes of the agent while the user has the workbook', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await copies.update(fixture.state());
        await copies.pause(true);

        // The agent writes both scripts, the user edits a.sql meanwhile: the edit goes into the copy
        fixture.agentWrites('scripts/a.sql', 'select 11');
        fixture.agentWrites('scripts/b.sql', 'select 22');
        await copies.update(fixture.state());
        fixture.edit('a.sql', 'select 111');
        await tick();
        await copies.settled();
        expect(fixture.taken).toEqual([]);
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 111');

        // The agent gets the workbook back: the page takes b.sql, a.sql keeps the text of the user
        await copies.update(fixture.state());
        expect(fixture.taken).toEqual([]);
        await copies.pause(false);
        expect(fixture.taken).toEqual([[fixture.keyOf('b.sql'), 'select 22']]);
        expect(fixture.page.get('a.sql')?.text).toBe('select 111');
    });

    it('takes no write of the page for a change of the agent', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1', 'b.sql': 'select 2', 'c.sql': 'select 3' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('w1');
        await copies.update(fixture.state());
        await copies.pause(true);

        // The user edits a.sql, the edit goes into the copy, and edits it again; the prompt goes back to AI before the
        // second edit is in the copy
        fixture.edit('a.sql', 'select 11');
        await tick();
        await copies.settled();
        await copies.update(fixture.state());
        fixture.edit('a.sql', 'select 111');
        await copies.pause(false);
        expect(fixture.taken).toEqual([]);
        expect(fixture.page.get('a.sql')?.text).toBe('select 111');
        await tick();
        await copies.settled();
        expect(fixture.copy.get('scripts/a.sql')?.text).toBe('select 111');

        // The user moves a script, the order goes into the copy, and moves another one before the state with the
        // stamp of that write arrives
        fixture.reorder(['b.sql', 'a.sql', 'c.sql']);
        await tick();
        await copies.settled();
        fixture.reorder(['c.sql', 'b.sql', 'a.sql']);
        await copies.update(fixture.state());
        expect([...fixture.page.keys()]).toEqual(['c.sql', 'b.sql', 'a.sql']);
        await tick();
        await copies.settled();
        expect(copyScriptOrder(fixture.copy.get('dashql-workbook.json')!.text)).toEqual(['c.sql', 'b.sql', 'a.sql']);
    });

    it('copies nothing of a workbook without a folder in OPFS and leaves the copies of other workbooks alone', async () => {
        const fixture = new Fixture({ 'a.sql': 'select 1' });
        const copies = new AgentSessionCopies(fixture.host, logger);
        await copies.copy('native');
        expect(copies.has('native')).toBe(true);
        expect(fixture.copy.size).toBe(0);
        // The copy of a workbook that this page did not copy
        const state = fixture.state();
        await copies.update({ ...state, workbooks: [{ ...state.workbooks[0], workbookId: 'other' }] });
        expect(fixture.taken).toEqual([]);
    });
});
