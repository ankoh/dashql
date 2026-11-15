import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const WORKBOOK = '11111111-2222-4333-8444-555555555555';

/// A host with a storage in memory and the timers of JS
class MemoryHost implements dashql.StorageWriterHost {
    workbooks = new Map<string, string>();
    scripts = new Map<string, string>();
    connections: string | null = null;
    calls: string[] = [];
    statistics = new Map<string, number[]>();
    externalChanges: string[] = [];
    /// Scripts changed outside the app, saving one rejects
    changedOutside = false;

    now() { return Date.now(); }
    setTimer(ms: number, callback: () => void) { return setTimeout(callback, ms); }
    clearTimer(timer: unknown) { clearTimeout(timer as ReturnType<typeof setTimeout>); }
    log() { }
    async loadWorkbook(workbookId: string) {
        const workbook = this.workbooks.get(workbookId);
        if (workbook == null) throw new Error(`No workbook ${workbookId}`);
        return workbook;
    }
    async saveWorkbook(workbookId: string, workbook: string) {
        this.calls.push(`manifest:${workbookId}`);
        this.workbooks.set(workbookId, workbook);
    }
    async saveScript(workbookId: string, fileName: string, text: string) {
        if (this.changedOutside) {
            throw Object.assign(new Error('changed outside the app'), { name: 'ExternalScriptChangeError', workbookId, fileName });
        }
        this.calls.push(`write:${fileName}=${text}`);
        this.scripts.set(fileName, text);
    }
    async deleteScript(_workbookId: string, fileName: string) { this.calls.push(`delete:${fileName}`); }
    async renameScript(_workbookId: string, from: string, to: string) { this.calls.push(`rename:${from}->${to}`); }
    async listAttachments() { return ['2.parquet', '10.parquet']; }
    async updateConnections(update: (connections: string | null) => string | null) {
        const next = update(this.connections);
        if (next != null) this.connections = next;
    }
    async saveConnectionFile(connectionId: string, fileName: string) { this.calls.push(`connection-file:${connectionId}/${fileName}`); }
    async deleteConnectionFiles() { }
    async deleteWorkbook(workbookId: string) { this.workbooks.delete(workbookId); }
    statisticsChanged(key: string, scheduled: number, writes: number) { this.statistics.set(key, [scheduled, writes]); }
    externalScriptChange(workbookId: string) { this.externalChanges.push(workbookId); }
}

describe('DashQL storage writer', () => {
    it('debounces writes on the timers of the host and flushes them', async () => {
        const host = new MemoryHost();
        const writer = dql!.createStorageWriter(host, 11);
        const key = `${WORKBOOK}/scripts/a.sql`;
        const first = writer.write(key, { type: 'writeScript', workbookId: WORKBOOK, fileName: 'a.sql', text: '1' }, 10_000);
        const second = writer.write(key, { type: 'writeScript', workbookId: WORKBOOK, fileName: 'a.sql', text: '2' }, 10_000);
        expect(writer.pendingKeys(WORKBOOK)).toEqual([key]);
        await expect(first).resolves.toEqual({ status: 'superseded' });
        await writer.flush();
        await expect(second).resolves.toEqual({ status: 'written' });
        expect(host.calls).toEqual(['write:a.sql=2']);
        expect(host.statistics.get(key)).toEqual([2, 1]);
        expect(writer.writeGenerations(WORKBOOK)).toEqual([[key, 2]]);
    });

    it('reads texts when the write runs and patches the workbook file', async () => {
        const host = new MemoryHost();
        host.workbooks.set(WORKBOOK, JSON.stringify({ workbookId: WORKBOOK, connections: [], scripts: [], attachments: [], metadata: {} }));
        const writer = dql!.createStorageWriter(host, 11);
        let text = 'select 1';
        const written = writer.write(`${WORKBOOK}/scripts`, {
            type: 'replaceWorkbookScripts', workbookId: WORKBOOK, name: 'Named', connection: null, originalFileName: null,
            scripts: [{ fileName: 'a.sql', text: () => text }],
        }, 5);
        text = 'select 2';
        await expect(written).resolves.toEqual({ status: 'written' });
        expect(host.scripts.get('a.sql')).toBe('select 2');
        await writer.writeDurable(`${WORKBOOK}/dashql-workbook.json:attachments`, { type: 'refreshWorkbookAttachments', workbookId: WORKBOOK });
        const workbook = JSON.parse(host.workbooks.get(WORKBOOK)!);
        expect(workbook.name).toBe('Named');
        expect(workbook.formatVersion).toBe(11);
        expect(workbook.attachments).toEqual([{ name: '2.parquet' }, { name: '10.parquet' }]);
    });

    it('hands back what the host failed with', async () => {
        const host = new MemoryHost();
        const writer = dql!.createStorageWriter(host, 11);
        const outcome = await writer.writeDurable(`${WORKBOOK}/dashql-workbook.json:scripts`, {
            type: 'writeWorkbookScripts', workbookId: WORKBOOK, scripts: [], connections: [],
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.status === 'failed' && outcome.unavailableWorkbook).toBe(WORKBOOK);
        expect(outcome.status === 'failed' && (outcome.error as Error).message).toBe(`No workbook ${WORKBOOK}`);
    });

    it('holds a script that changed outside the app', async () => {
        const host = new MemoryHost();
        host.changedOutside = true;
        const writer = dql!.createStorageWriter(host, 11);
        const held = writer.write(`${WORKBOOK}/scripts/a.sql`, { type: 'writeScript', workbookId: WORKBOOK, fileName: 'a.sql', text: 'x' }, 0);
        await new Promise(resolve => setTimeout(resolve, 10));
        await writer.settle();
        expect(host.externalChanges).toEqual([WORKBOOK]);
        expect(writer.isWorkbookPaused(WORKBOOK)).toBe(true);
        host.changedOutside = false;
        writer.resumeWorkbook(WORKBOOK);
        await expect(held).resolves.toEqual({ status: 'written' });
    });

    it('updates the connection entries exclusively', async () => {
        const host = new MemoryHost();
        host.connections = JSON.stringify([{ id: 'a', params: {}, createdAt: 't' }]);
        const writer = dql!.createStorageWriter(host, 11);
        await writer.writeDurable('@manifest/connections/a', { type: 'writeConnectionEntry', entry: { id: 'a', params: { x: 1 } } });
        expect(JSON.parse(host.connections!)).toEqual([{ id: 'a', params: { x: 1 }, createdAt: 't' }]);
    });
});
