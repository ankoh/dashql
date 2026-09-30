import { readFile } from '../electron_fs.js';
import { PlatformFile } from './file.js';

export class NativeFile implements PlatformFile {
    /// The file path
    public readonly path: string;

    /// The constructor
    constructor(path: string) {
        this.path = path;
    }
    /// Open a stream for reading the file
    stream(): ReadableStream<Uint8Array> {
        return new ReadableStream({
            start: async controller => {
                try {
                    controller.enqueue(await this.readAsArrayBuffer());
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            },
        });
    }
    /// Read the file as array buffer
    async readAsArrayBuffer(): Promise<Uint8Array> {
        const file = await readFile(this.path);
        return file;
    }
}
