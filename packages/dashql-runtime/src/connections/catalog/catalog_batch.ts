import * as flatbuffers from 'flatbuffers';
import * as buffers from '@ankoh/dashql-core/buffers';
import type { DashQL, DashQLCatalog } from '@ankoh/dashql-core';
import type { BatchRequest, BatchResult } from '@ankoh/dashql-core';

/// A script that keeps the text of a descriptor, e.g. the script with the functions of a connection
export interface CatalogSourceScript {
    readonly catalog_entry_id: number;
    toString(): string;
    replaceText(text: string): void;
}

/// SQL of the connection catalog, published as a descriptor in the connection layer. A script keeps the text, an entry
/// id only gets the descriptor.
export type CatalogBatchEntry = ({ script: CatalogSourceScript; entryId?: undefined } | { entryId: number; script?: undefined }) & {
    text: string;
    requireFunctions?: boolean;
};

function entryIdOf(entry: CatalogBatchEntry): number {
    return entry.script?.catalog_entry_id ?? entry.entryId!;
}

function batchRequest(entries: CatalogBatchEntry[]): BatchRequest {
    return { scripts: entries.map(entry => ({
        id: entryIdOf(entry).toString(),
        text: entry.text,
        outputs: ['catalogDescriptor'],
    })) };
}

function commitCatalogBatch(catalog: DashQLCatalog, entries: CatalogBatchEntry[], result: BatchResult) {
    if (result.scripts.length !== entries.length) throw new Error('Catalog batch returned an unexpected script count');
    const prepared = entries.map(entry => {
        const matches = result.scripts.filter(script => script.id === entryIdOf(entry).toString());
        const output = matches[0];
        if (matches.length !== 1 || output.failure) {
            throw new Error(output?.failure ?? 'Catalog batch did not return a descriptor');
        }
        const error = output.diagnostics.find(diagnostic => diagnostic.severity === 'error');
        if (error) throw new Error(`Catalog contains invalid SQL: ${error.message}`);
        if (!output.catalogDescriptor?.length) throw new Error('Catalog batch did not return a descriptor');
        const descriptor = buffers.catalog.CatalogDescriptor.getRootAsCatalogDescriptor(new flatbuffers.ByteBuffer(output.catalogDescriptor));
        const counts = { tables: descriptor.tablesLength(), functions: descriptor.functionDeclarationsLength() };
        if (entry.requireFunctions && counts.functions === 0) throw new Error('Hyper function catalog is empty');
        return { descriptor: output.catalogDescriptor, counts };
    });

    for (let i = 0; i < entries.length; ++i) {
        const entry = entries[i];
        const previousText = entry.script?.toString();
        try {
            entry.script?.replaceText(entry.text);
            catalog.replaceDescriptor(entryIdOf(entry), buffers.catalog.CatalogLayer.CONNECTION, prepared[i].descriptor);
        } catch (error) {
            try {
                if (previousText != null) entry.script?.replaceText(previousText);
            } catch {
                // Preserve the import/write failure if restoring this source also fails.
            }
            throw error;
        }
    }
    return prepared.map(entry => entry.counts);
}

/// Publish catalog SQL right away. The batch prepares isolated descriptors, it never parses on the catalog it publishes
/// into. The catalog loader of the Rust runtime publishes the updates of connections, this is for tests and tools.
export function publishCatalogBatchSync(core: DashQL, catalog: DashQLCatalog, entries: CatalogBatchEntry[]) {
    if (entries.length === 0) return [];
    return commitCatalogBatch(catalog, entries, core.processBatch(batchRequest(entries)));
}
