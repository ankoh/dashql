import { FileDownloader } from './file_downloader.js';

import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

export class NativeFileDownloader implements FileDownloader {
    async downloadBufferAsFile(data: Uint8Array, filename: string): Promise<void> {
        const dot = filename.lastIndexOf('.');
        const ext = dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1) : '';
        const filters = ext.length > 0
            ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }]
            : undefined;
        const path = await save({
            defaultPath: filename,
            filters,
        });
        if (path != null) {
            await writeFile(path, data);
        }
    }
}


