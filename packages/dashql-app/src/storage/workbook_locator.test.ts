import { describe, it, expect } from 'vitest';
import { locationFromEntry, displayPath, type WorkbookLocation } from './workbook_locator.js';
import { StorageBackendType, type WorkbookEntry } from '@ankoh/dashql-runtime/storage/storage_backend';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('locationFromEntry', () => {
    it('treats an entry with no location field as OPFS', () => {
        const entry: WorkbookEntry = { path: UUID };
        expect(locationFromEntry(entry)).toEqual({ type: StorageBackendType.OPFS });
    });

    it('treats an explicit opfs entry as OPFS', () => {
        const entry: WorkbookEntry = { path: UUID, storageType: StorageBackendType.OPFS };
        expect(locationFromEntry(entry)).toEqual({ type: StorageBackendType.OPFS });
    });

    it('maps a native entry with a nativePath to a native location', () => {
        const entry: WorkbookEntry = {
            path: UUID,
            storageType: StorageBackendType.Native,
            nativePath: '/Users/test/my-workbook',
        };
        expect(locationFromEntry(entry)).toEqual({
            type: StorageBackendType.Native,
            nativePath: '/Users/test/my-workbook',
        });
    });

    it('falls back to OPFS for a native entry missing its nativePath', () => {
        const entry: WorkbookEntry = { path: UUID, storageType: StorageBackendType.Native };
        expect(locationFromEntry(entry)).toEqual({ type: StorageBackendType.OPFS });
    });
});

describe('displayPath', () => {
    it('renders a display opfs:// path for an OPFS workbook', () => {
        const loc: WorkbookLocation = { type: StorageBackendType.OPFS };
        expect(displayPath(UUID, loc)).toBe(`opfs://workbooks/${UUID}`);
    });

    it('renders a display fs:// path for a native workbook', () => {
        const loc: WorkbookLocation = { type: StorageBackendType.Native, nativePath: '/Users/test/my-workbook' };
        expect(displayPath(UUID, loc)).toBe('fs:///Users/test/my-workbook');
    });

    it('falls back to the opfs:// path when a native location has no path', () => {
        const loc: WorkbookLocation = { type: StorageBackendType.Native };
        expect(displayPath(UUID, loc)).toBe(`opfs://workbooks/${UUID}`);
    });
});
