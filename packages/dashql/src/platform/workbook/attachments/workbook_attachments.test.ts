import { describe, expect, it } from 'vitest';

import { attachmentPath, attachmentPrefix } from './workbook_attachments.js';

describe('workbook attachments', () => {
    it('mounts the attachments of a workbook in a folder of their own', () => {
        expect(attachmentPrefix('s1')).toBe('/mnt/external/attachments/s1');
        expect(attachmentPath('s1', 'sales.parquet')).toBe('/mnt/external/attachments/s1/sales.parquet');
    });
});
