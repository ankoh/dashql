import { describe, it, expect } from 'vitest';
import { locationFromEntry, displayPath, type NotebookLocation } from './notebook_locator.js';
import { StorageBackendType, type NotebookEntry } from './storage_backend.js';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('locationFromEntry', () => {
    it('treats an entry with no location field as OPFS', () => {
        const entry: NotebookEntry = { path: UUID };
        expect(locationFromEntry(entry)).toEqual({ type: StorageBackendType.OPFS });
    });

    it('treats an explicit opfs entry as OPFS', () => {
        const entry: NotebookEntry = { path: UUID, storageType: StorageBackendType.OPFS };
        expect(locationFromEntry(entry)).toEqual({ type: StorageBackendType.OPFS });
    });

    it('maps a native entry with a nativePath to a native location', () => {
        const entry: NotebookEntry = {
            path: UUID,
            storageType: StorageBackendType.Native,
            nativePath: '/Users/test/my-notebook',
        };
        expect(locationFromEntry(entry)).toEqual({
            type: StorageBackendType.Native,
            nativePath: '/Users/test/my-notebook',
        });
    });

    it('falls back to OPFS for a native entry missing its nativePath', () => {
        const entry: NotebookEntry = { path: UUID, storageType: StorageBackendType.Native };
        expect(locationFromEntry(entry)).toEqual({ type: StorageBackendType.OPFS });
    });
});

describe('displayPath', () => {
    it('renders a display opfs:// path for an OPFS notebook', () => {
        const loc: NotebookLocation = { type: StorageBackendType.OPFS };
        expect(displayPath(UUID, loc)).toBe(`opfs://notebooks/${UUID}`);
    });

    it('renders a display fs:// path for a native notebook', () => {
        const loc: NotebookLocation = { type: StorageBackendType.Native, nativePath: '/Users/test/my-notebook' };
        expect(displayPath(UUID, loc)).toBe('fs:///Users/test/my-notebook');
    });

    it('falls back to the opfs:// path when a native location has no path', () => {
        const loc: NotebookLocation = { type: StorageBackendType.Native };
        expect(displayPath(UUID, loc)).toBe(`opfs://notebooks/${UUID}`);
    });
});
