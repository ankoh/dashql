import * as flatbuffers from 'flatbuffers';
import { describe, expect, it, vi } from 'vitest';
import * as buffers from '@ankoh/dashql-core/buffers';
import type { DashQLCatalog, DashQLScript } from '@ankoh/dashql-core';
import type { BatchRequest, BatchResult } from '@ankoh/dashql-core';
import { publishCatalogBatchSync } from './catalog_batch.js';
import type { DashQL } from '@ankoh/dashql-core';

function fixture() {
    const builder = new flatbuffers.Builder();
    builder.finish(new buffers.catalog.CatalogDescriptorT().pack(builder));
    const descriptor = builder.asUint8Array();
    const processor = vi.fn((request: BatchRequest): BatchResult => ({
        scripts: request.scripts.map(script => ({ id: script.id, diagnostics: [], catalogDescriptor: descriptor })),
    }));
    const source = (id: number) => {
        let text = `old SQL ${id}`;
        return {
            catalog_entry_id: id,
            replaceText: vi.fn((next: string) => { text = next; }),
            toString: () => text,
            analyze: vi.fn(),
            parse: vi.fn(),
        } as unknown as DashQLScript;
    };
    const relation = source(1);
    const functions = source(2);
    const entries = [
        { script: relation, text: 'next relations' },
        { script: functions, text: 'next functions' },
    ];
    const pools = new Map<number, Uint8Array>([[1, new Uint8Array([1])], [2, new Uint8Array([2])]]);
    const catalog = { replaceDescriptor: vi.fn((id: number, _rank: number, bytes: Uint8Array) => { pools.set(id, bytes); }) } as unknown as DashQLCatalog;
    const core = { processBatch: processor } as unknown as DashQL;
    return { core, catalog, entries, relation, functions, processor, descriptor, pools };
}

describe('catalog batch publication', () => {
    it('prepares descriptors and publishes each identity immediately after writing its persistence SQL', () => {
        const f = fixture();
        const replace = vi.mocked(f.catalog.replaceDescriptor).getMockImplementation()!;
        vi.mocked(f.catalog.replaceDescriptor).mockImplementation((id, layer, bytes) => {
            expect(f.relation.toString()).toBe('next relations');
            if (id === 1) {
                expect(f.functions.replaceText).not.toHaveBeenCalled();
                expect(f.functions.toString()).toBe('old SQL 2');
            } else {
                expect(f.functions.toString()).toBe('next functions');
                expect(f.pools.get(1)).toBe(f.descriptor);
            }
            replace(id, layer, bytes);
        });
        expect(publishCatalogBatchSync(f.core, f.catalog, f.entries))
            .toEqual([{ tables: 0, functions: 0 }, { tables: 0, functions: 0 }]);
        expect(f.processor).toHaveBeenCalledWith({ scripts: [
            { id: '1', text: 'next relations', outputs: ['catalogDescriptor'] },
            { id: '2', text: 'next functions', outputs: ['catalogDescriptor'] },
        ] });
        expect(f.catalog.replaceDescriptor).toHaveBeenCalledTimes(2);
        expect(f.catalog.replaceDescriptor).toHaveBeenNthCalledWith(1, 1, buffers.catalog.CatalogLayer.CONNECTION, f.descriptor);
        expect(f.catalog.replaceDescriptor).toHaveBeenNthCalledWith(2, 2, buffers.catalog.CatalogLayer.CONNECTION, f.descriptor);
        expect(f.pools.get(1)).toBe(f.descriptor);
        expect(f.pools.get(2)).toBe(f.descriptor);
        expect(f.relation.toString()).toBe('next relations');
        expect(f.functions.toString()).toBe('next functions');
        expect(f.relation.analyze).not.toHaveBeenCalled();
        expect(f.functions.parse).not.toHaveBeenCalled();
    });

    it.each(['worker failure', 'diagnostic', 'missing descriptor', 'empty descriptor', 'script failure', 'wrong identity', 'duplicate identity', 'wrong script count', 'missing functions'])
        ('rejects %s before changing any source or pool', failure => {
            const f = fixture();
            if (failure === 'worker failure') f.processor.mockImplementation(() => { throw new Error('worker failed'); });
            else {
                const result = f.processor({ scripts: [
                    { id: '1', text: '', outputs: [] }, { id: '2', text: '', outputs: [] },
                ] });
                if (failure === 'diagnostic') result.scripts[1].diagnostics.push({ stage: 'parse', severity: 'error', offset: 0, length: 1, message: 'invalid' });
                if (failure === 'missing descriptor') delete result.scripts[1].catalogDescriptor;
                if (failure === 'empty descriptor') result.scripts[1].catalogDescriptor = new Uint8Array();
                if (failure === 'script failure') result.scripts[1].failure = 'analysis failed';
                if (failure === 'wrong identity') result.scripts[1].id = 'other';
                if (failure === 'duplicate identity') result.scripts[1].id = '1';
                if (failure === 'wrong script count') result.scripts.pop();
                f.processor.mockReturnValue(result);
            }
            const entries = f.entries.map((entry, i) => ({ ...entry, requireFunctions: failure === 'missing functions' && i === 1 }));
            expect(() => publishCatalogBatchSync(f.core, f.catalog, entries)).toThrow();
            expect(f.relation.toString()).toBe('old SQL 1');
            expect(f.functions.toString()).toBe('old SQL 2');
            expect(f.relation.replaceText).not.toHaveBeenCalled();
            expect(f.functions.replaceText).not.toHaveBeenCalled();
            expect(f.catalog.replaceDescriptor).not.toHaveBeenCalled();
            expect(f.pools.get(1)).toEqual(new Uint8Array([1]));
            expect(f.pools.get(2)).toEqual(new Uint8Array([2]));
            });

    it.each(['first', 'second'])('rolls back only the failing %s source write and retains earlier publication', position => {
        const f = fixture();
        const script = position === 'first' ? f.relation : f.functions;
        vi.mocked(script.replaceText).mockImplementationOnce(() => { throw new Error('source allocation failed'); });
        expect(() => publishCatalogBatchSync(f.core, f.catalog, f.entries)).toThrow('source allocation failed');
        expect(f.catalog.replaceDescriptor).toHaveBeenCalledTimes(position === 'first' ? 0 : 1);
        expect(script.replaceText).toHaveBeenNthCalledWith(1, position === 'first' ? 'next relations' : 'next functions');
        expect(script.replaceText).toHaveBeenNthCalledWith(2, position === 'first' ? 'old SQL 1' : 'old SQL 2');
        expect(f.relation.toString()).toBe(position === 'first' ? 'old SQL 1' : 'next relations');
        expect(f.functions.toString()).toBe('old SQL 2');
        expect(f.pools.get(1)).toEqual(position === 'first' ? new Uint8Array([1]) : f.descriptor);
        expect(f.pools.get(2)).toEqual(new Uint8Array([2]));
        if (position === 'first') expect(f.functions.replaceText).not.toHaveBeenCalled();
        else {
            expect(f.catalog.replaceDescriptor).toHaveBeenCalledExactlyOnceWith(1, buffers.catalog.CatalogLayer.CONNECTION, f.descriptor);
            expect(f.relation.replaceText).toHaveBeenCalledExactlyOnceWith('next relations');
        }
    });

    it.each(['first', 'second'])('restores only the %s source that mutated before throwing', position => {
        const f = fixture();
        const script = position === 'first' ? f.relation : f.functions;
        const replace = script.replaceText;
        const implementation = vi.mocked(replace).getMockImplementation()!;
        vi.mocked(replace).mockImplementationOnce(text => {
            implementation(text);
            throw new Error('source write failed after mutation');
        });
        expect(() => publishCatalogBatchSync(f.core, f.catalog, f.entries)).toThrow('source write failed after mutation');
        expect(f.catalog.replaceDescriptor).toHaveBeenCalledTimes(position === 'first' ? 0 : 1);
        expect(f.relation.toString()).toBe(position === 'first' ? 'old SQL 1' : 'next relations');
        expect(f.functions.toString()).toBe('old SQL 2');
        expect(script.replaceText).toHaveBeenCalledTimes(2);
        expect(script.replaceText).toHaveBeenLastCalledWith(position === 'first' ? 'old SQL 1' : 'old SQL 2');
        expect(f.pools.get(1)).toEqual(position === 'first' ? new Uint8Array([1]) : f.descriptor);
        expect(f.pools.get(2)).toEqual(new Uint8Array([2]));
        if (position === 'first') expect(f.functions.replaceText).not.toHaveBeenCalled();
        else expect(f.relation.replaceText).toHaveBeenCalledExactlyOnceWith('next relations');
    });

    it.each(['first', 'second'])('rolls back only the %s source on import failure and retains earlier pools', position => {
        const f = fixture();
        const replace = vi.mocked(f.catalog.replaceDescriptor).getMockImplementation()!;
        vi.mocked(f.catalog.replaceDescriptor).mockImplementation((id, layer, bytes) => {
            expect(id === 1 ? f.relation.toString() : f.functions.toString()).toBe(id === 1 ? 'next relations' : 'next functions');
            if (id === (position === 'first' ? 1 : 2)) throw new Error('import failed');
            replace(id, layer, bytes);
        });
        expect(() => publishCatalogBatchSync(f.core, f.catalog, f.entries)).toThrow('import failed');
        expect(f.catalog.replaceDescriptor).toHaveBeenCalledTimes(position === 'first' ? 1 : 2);
        expect(f.catalog.replaceDescriptor).toHaveBeenNthCalledWith(1, 1, buffers.catalog.CatalogLayer.CONNECTION, f.descriptor);
        expect(f.relation.toString()).toBe(position === 'first' ? 'old SQL 1' : 'next relations');
        expect(f.functions.toString()).toBe('old SQL 2');
        expect(f.pools.get(1)).toEqual(position === 'first' ? new Uint8Array([1]) : f.descriptor);
        expect(f.pools.get(2)).toEqual(new Uint8Array([2]));
        const script = position === 'first' ? f.relation : f.functions;
        expect(script.replaceText).toHaveBeenCalledTimes(2);
        expect(script.replaceText).toHaveBeenNthCalledWith(1, position === 'first' ? 'next relations' : 'next functions');
        expect(script.replaceText).toHaveBeenNthCalledWith(2, position === 'first' ? 'old SQL 1' : 'old SQL 2');
        if (position === 'first') expect(f.functions.replaceText).not.toHaveBeenCalled();
        else {
            expect(f.catalog.replaceDescriptor).toHaveBeenNthCalledWith(2, 2, buffers.catalog.CatalogLayer.CONNECTION, f.descriptor);
            expect(f.relation.replaceText).toHaveBeenCalledExactlyOnceWith('next relations');
        }
    });

    it('synchronous preparation rejects processing failures before mutating source SQL', () => {
        const f = fixture();
        f.processor.mockImplementation(() => { throw new Error('batch failed'); });
        expect(() => publishCatalogBatchSync(f.core, f.catalog, f.entries)).toThrow('batch failed');
        expect(f.catalog.replaceDescriptor).not.toHaveBeenCalled();
        expect(f.relation.toString()).toBe('old SQL 1');
        expect(f.functions.toString()).toBe('old SQL 2');
    });
});
