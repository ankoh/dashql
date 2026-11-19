/// Save bytes as a file of the user through a temporary link of the browser, the desktop app takes the download the same
/// way. A Blob is handed over as it is, a large one is never copied into memory.
export async function downloadFile(data: Uint8Array | Blob, fileName: string): Promise<void> {
    // A Blob of a Blob refers to the same bytes, nothing is copied
    const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
