import { describe, expect, it } from 'vitest';

import { reconcileWorkbookScripts, remapWorkbookScripts, sanitizeWorkbookFiles, workbookAttachments, withWorkbookScripts } from './workbook_files.js';
import { TEST_CONNECTION_ID, testWorkbook } from './workbook_test_backend.js';

const OTHER_CONNECTION_ID = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';

describe('workbook file lists', () => {
    it('keeps the order of the listed scripts and appends unlisted files in natural order', () => {
        const result = reconcileWorkbookScripts([
            { name: '10_b.sql', connectionId: OTHER_CONNECTION_ID },
            { name: 'missing.sql', connectionId: TEST_CONNECTION_ID },
            { name: '2_a.sql', connectionId: TEST_CONNECTION_ID },
        ], ['2_a.sql', '10_b.sql', '3_new.sql', '20_new.sql'], TEST_CONNECTION_ID);
        expect(result).toEqual({
            scripts: [
                { name: '10_b.sql', connectionId: OTHER_CONNECTION_ID },
                { name: '2_a.sql', connectionId: TEST_CONNECTION_ID },
                { name: '3_new.sql', connectionId: TEST_CONNECTION_ID },
                { name: '20_new.sql', connectionId: TEST_CONNECTION_ID },
            ],
            changed: true,
        });
    });

    it('reports an unchanged list and follows the case of the files', () => {
        const scripts = [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }];
        expect(reconcileWorkbookScripts(scripts, ['a.sql'], TEST_CONNECTION_ID)).toEqual({ scripts, changed: false });
        expect(reconcileWorkbookScripts([...scripts, { name: 'A.SQL', connectionId: OTHER_CONNECTION_ID }], ['A.sql'], TEST_CONNECTION_ID))
            .toEqual({ scripts: [{ name: 'A.sql', connectionId: TEST_CONNECTION_ID }], changed: true });
    });

    it('drops unusable entries of a hand-edited workbook file', () => {
        const files = sanitizeWorkbookFiles(testWorkbook({
            scripts: [
                { name: '../escape.sql', connectionId: TEST_CONNECTION_ID },
                { name: 'dashql-draft.sql', connectionId: TEST_CONNECTION_ID },
                { name: 'notes.txt', connectionId: TEST_CONNECTION_ID },
                { name: 'a.sql', connectionId: 'not-a-uuid' },
                { name: 'b.sql', connectionId: TEST_CONNECTION_ID },
                { name: 'B.sql', connectionId: TEST_CONNECTION_ID },
            ],
            attachments: [{ name: '10.parquet' }, { name: '2.parquet' }, { name: 'a/b.parquet' }, { name: 'notes.csv' }],
        }));
        // A workbook attaches Parquet files only
        expect(files).toEqual({
            scripts: [{ name: 'b.sql', connectionId: TEST_CONNECTION_ID }],
            attachments: [{ name: '2.parquet' }, { name: '10.parquet' }],
            valid: false,
        });
        expect(sanitizeWorkbookFiles(testWorkbook()).valid).toBe(true);
        expect(sanitizeWorkbookFiles({ ...testWorkbook(), scripts: undefined } as any)).toMatchObject({ scripts: [], valid: false });
    });

    it('sorts attachments and remaps the connections of scripts', () => {
        expect(workbookAttachments(['10.parquet', '2.parquet'])).toEqual([{ name: '2.parquet' }, { name: '10.parquet' }]);
        expect(remapWorkbookScripts([
            { name: 'a.sql', connectionId: TEST_CONNECTION_ID },
            { name: 'b.sql', connectionId: OTHER_CONNECTION_ID },
        ], new Map([[TEST_CONNECTION_ID, 'new']]))).toEqual([
            { name: 'a.sql', connectionId: 'new' },
            { name: 'b.sql', connectionId: OTHER_CONNECTION_ID },
        ]);
    });
});

describe('workbook connections', () => {
    const copy = { connectionId: OTHER_CONNECTION_ID, params: { trino: { endpoint: 'https://trino.example' } } as any };

    it('holds the connections of the scripts in the order the scripts first use them', () => {
        const scripts = [
            { name: 'a.sql', connectionId: OTHER_CONNECTION_ID },
            { name: 'b.sql', connectionId: TEST_CONNECTION_ID },
            { name: 'c.sql', connectionId: OTHER_CONNECTION_ID },
        ];
        const next = withWorkbookScripts(testWorkbook(), scripts, [copy]);
        expect(next.connections.map(connection => connection.connectionId)).toEqual([OTHER_CONNECTION_ID, TEST_CONNECTION_ID]);
    });

    it('drops a connection that no script uses', () => {
        const next = withWorkbookScripts(testWorkbook({ connections: [testWorkbook().connections[0], copy] }), [{ name: 'a.sql', connectionId: OTHER_CONNECTION_ID }]);
        expect(next.connections).toEqual([copy]);
    });

    it('keeps the connection of the next script in a workbook without scripts', () => {
        expect(withWorkbookScripts(testWorkbook(), []).connections).toEqual(testWorkbook().connections);
        expect(withWorkbookScripts(testWorkbook(), [], [copy]).connections).toEqual([copy]);
    });

    it('appends script files without an entry on the connection of the script before them', () => {
        const reconciled = reconcileWorkbookScripts([{ name: 'a.sql', connectionId: OTHER_CONNECTION_ID }], ['a.sql', 'b.sql'], TEST_CONNECTION_ID);
        expect(reconciled.scripts).toEqual([
            { name: 'a.sql', connectionId: OTHER_CONNECTION_ID },
            { name: 'b.sql', connectionId: OTHER_CONNECTION_ID },
        ]);
        expect(reconcileWorkbookScripts([], ['a.sql'], TEST_CONNECTION_ID).scripts).toEqual([{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }]);
    });
});
