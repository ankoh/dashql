import { describe, expect, it } from 'vitest';

import { attachmentParameterName, attachmentPrefix, planAttachments, readSessionAttachments, sameSessionAttachments, renamedAttachmentFileName, uniqueAttachmentFileName } from './session_attachments.js';

describe('session attachments', () => {
    it('names the table parameter of a Parquet file after the file', () => {
        expect(attachmentParameterName('sales.parquet')).toBe('sales');
        expect(attachmentParameterName('Sales.2024.PARQUET')).toBe('Sales.2024');
        expect(attachmentParameterName('notes.csv')).toBeNull();
        expect(attachmentParameterName('.parquet')).toBeNull();
    });

    it('keeps the columns of an attachment whose file is unchanged', () => {
        const first = readSessionAttachments([{ name: 'a.parquet', sizeBytes: 1, mtimeMs: 1 }, { name: 'b.parquet', sizeBytes: 1, mtimeMs: 1 }]);
        const described = first.map(a => ({ ...a, columns: ['x'] }));
        const next = readSessionAttachments([{ name: 'a.parquet', sizeBytes: 1, mtimeMs: 1 }, { name: 'b.parquet', sizeBytes: 2, mtimeMs: 3 }], described);
        expect(next.map(a => a.columns)).toEqual([['x'], null]);
        expect(sameSessionAttachments(described, next)).toBe(false);
        expect(sameSessionAttachments(next, readSessionAttachments([{ name: 'a.parquet', sizeBytes: 1, mtimeMs: 1 }, { name: 'b.parquet', sizeBytes: 2, mtimeMs: 3 }], next))).toBe(true);
    });

    it('passes the Parquet attachments to the core', () => {
        const attachments = readSessionAttachments([{ name: 'notes.txt', sizeBytes: 1 }, { name: 'sales.parquet', sizeBytes: 5, mtimeMs: 7 }]);
        expect(planAttachments(attachments)).toEqual([{ name: 'sales', file: 'sales.parquet', stamp: '5-7', columns: null }]);
        expect(attachmentPrefix('s1')).toBe('/mnt/external/attachments/s1');
    });

    it('names a new attachment past the scripts and the other attachments', () => {
        const attachments = readSessionAttachments([{ name: 'orders.parquet', sizeBytes: 1 }, { name: 'sales-2.parquet', sizeBytes: 1 }]);
        expect(uniqueAttachmentFileName('Sales.parquet', ['sales', 'items'], attachments)).toBe('Sales-3.parquet');
        expect(uniqueAttachmentFileName('ORDERS.parquet', [], attachments)).toBe('ORDERS-2.parquet');
        // A file with the name of an attachment replaces it, other files keep their names
        expect(uniqueAttachmentFileName('orders.parquet', ['orders'], attachments)).toBe('orders.parquet');
        expect(uniqueAttachmentFileName('sales.csv', ['sales'], attachments)).toBe('sales.csv');
        expect(uniqueAttachmentFileName('fresh.parquet', ['sales'], attachments)).toBe('fresh.parquet');
    });

    it('names a renamed attachment past the scripts and the other attachments', () => {
        const attachments = readSessionAttachments([{ name: 'sales.parquet', sizeBytes: 1 }, { name: 'orders.parquet', sizeBytes: 1 }]);
        expect(renamedAttachmentFileName('sales.parquet', ' revenue ', ['items'], attachments)).toBe('revenue.parquet');
        expect(renamedAttachmentFileName('sales.parquet', 'revenue.parquet', [], attachments)).toBe('revenue.parquet');
        expect(renamedAttachmentFileName('sales.parquet', 'Items', ['items'], attachments)).toBe('Items-2.parquet');
        expect(renamedAttachmentFileName('sales.parquet', 'ORDERS', [], attachments)).toBe('ORDERS-2.parquet');
        // The attachment may keep its name or change its case
        expect(renamedAttachmentFileName('sales.parquet', 'Sales', [], attachments)).toBe('Sales.parquet');
        expect(renamedAttachmentFileName('sales.parquet', 'a/b', [], attachments)).toBeNull();
        expect(renamedAttachmentFileName('sales.parquet', '  ', [], attachments)).toBeNull();
    });
});
