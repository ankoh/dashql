import { FileDownloader } from './file_downloader.js';

export class WebFileDownloader implements FileDownloader {
    async downloadBufferAsFile(data: Uint8Array | Blob, filename: string): Promise<void> {
        // A Blob of a Blob refers to the same bytes, nothing is copied
        const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
        // Create a temporary URL for the Blob
        const url = URL.createObjectURL(blob);
        // Create an anchor element and trigger the download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        // Clean up after download
        document.body.removeChild(a);
        // Release blob memory
        URL.revokeObjectURL(url);
    }
}
