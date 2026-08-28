import { FileDownloader } from './file_downloader.js';

export class NativeFileDownloader implements FileDownloader {
    async downloadBufferAsFile(data: Uint8Array, filename: string): Promise<void> {
        const dot = filename.lastIndexOf('.');
        const ext = dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1) : '';
        const filters = ext.length > 0
            ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }]
            : undefined;
        void filters;
        const blob = new Blob([new Uint8Array(data)]);
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(anchor.href);
    }
}
