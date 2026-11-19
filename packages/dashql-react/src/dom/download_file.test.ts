import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadFile } from './download_file.js';

describe('downloadFile', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('downloads the bytes through a temporary link', async () => {
        const blobs: Blob[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
            blobs.push(blob as Blob);
            return 'blob:download';
        });
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
        const clicked: { href: string; download: string; attached: boolean }[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
        });

        await downloadFile(new Uint8Array([1, 2, 3]), 'workbook.dashql');

        expect(clicked).toEqual([{ href: 'blob:download', download: 'workbook.dashql', attached: true }]);
        expect(blobs.length).toBe(1);
        expect(blobs[0].type).toBe('application/octet-stream');
        expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        expect(revoke).toHaveBeenCalledWith('blob:download');
        expect(document.querySelector('a[download="workbook.dashql"]')).toBeNull();
    });
});
