import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

const WORKBOOK = '11111111-2222-4333-8444-555555555555';
const CONNECTION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function workbookFile(overrides: object = {}) {
    return {
        formatVersion: dql!.workbookFormat.constants().formatVersion,
        workbookId: WORKBOOK,
        name: 'w',
        connections: [{ connectionId: CONNECTION, params: { hyper: {} } }],
        scripts: [{ name: 'a.sql', connectionId: CONNECTION }],
        attachments: [],
        metadata: {},
        ...overrides,
    };
}

// The format is tested in the crate, these tests cross the bindings
describe('the workbook format', () => {
    it('validates and migrates workbook files', () => {
        const format = dql!.workbookFormat;
        expect(format.validate(workbookFile())).toBeNull();
        expect(format.validate(workbookFile({ workbookId: 'x' }))).toBe('invalid_workbook_id');
        expect(format.describeValidationError('invalid_workbook_id')).toBe('Invalid workbook id');
        const { result, changes } = format.migrate([['dashql-session.json', JSON.stringify({ ...workbookFile({ formatVersion: 10 }), workbookId: undefined, sessionId: WORKBOOK })]]);
        expect(result).toBe('migrated');
        expect(changes.map(change => [change.kind, change.name])).toEqual([['write', 'dashql-workbook.json'], ['remove', 'dashql-session.json']]);
    });

    it('resolves scripts over a resolver and evicts over the host', () => {
        const format = dql!.workbookFormat;
        const resolved = format.resolveWorkbookScripts(workbookFile(), ['a.sql', 'b.sql'], {
            resolve: id => JSON.stringify({ connectionId: id, params: { hyper: {} } }),
            fallback: () => JSON.stringify({ connectionId: 'fallback', params: { hyper: {} } }),
            unresolved: () => { },
        });
        expect(resolved.scripts.map(script => [script.name, script.connectionId])).toEqual([['a.sql', CONNECTION], ['b.sql', CONNECTION]]);

        const eviction = format.cacheEviction([
            { name: 'old', size: 40, mtimeMs: 1, lastAccessMs: 1 },
            { name: 'new', size: 40, mtimeMs: 2, lastAccessMs: 2 },
        ], 50, 100);
        expect(eviction.nextCandidate()).toBe('old');
        eviction.deleted();
        expect(eviction.nextCandidate()).toBeNull();
        eviction.destroy();
    });
});
