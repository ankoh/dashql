import { describe, expect, it } from 'vitest';

import { attachmentParameterName, attachmentPrefix, renamedAttachmentFileName } from './workbook_attachments.js';

describe('workbook attachments', () => {
    it('names the table parameter of a Parquet file after the file', () => {
        expect(attachmentParameterName('sales.parquet')).toBe('sales');
        expect(attachmentParameterName('Sales.2024.PARQUET')).toBe('Sales.2024');
        expect(attachmentParameterName('notes.csv')).toBeNull();
        expect(attachmentParameterName('.parquet')).toBeNull();
        expect(attachmentPrefix('s1')).toBe('/mnt/external/attachments/s1');
    });

    it('names a renamed attachment past the scripts and the other attachments', () => {
        const attachments = [{ fileName: 'sales.parquet', name: 'sales' }, { fileName: 'orders.parquet', name: 'orders' }];
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
