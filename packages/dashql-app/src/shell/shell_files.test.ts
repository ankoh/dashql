// @vitest-environment node
import type { PlatformFile } from '../platform/file/file.js';
import { createShellFilesCommand, ShellFileRegistry } from './shell_files.js';

function file(path: string, bytes: number[]): PlatformFile {
    return {
        path,
        readAsArrayBuffer: async () => new Uint8Array(bytes),
    };
}

describe('shell files command', () => {
    it('adds, lists, gets, and drops platform files', async () => {
        const registry = new ShellFileRegistry();
        const downloader = { downloadBufferAsFile: vi.fn().mockResolvedValue(undefined) };
        const selectFiles = vi.fn().mockResolvedValue([
            file('/tmp/b.csv', [2]),
            file('/tmp/a file.csv', [1]),
        ]);
        const command = createShellFilesCommand(registry, downloader, selectFiles);

        expect(await command[2](['list'], {})).toBe('No files registered');
        expect(await command[2](['add'], {})).toBe('Added 2 files');
        expect(await command[2]([], {})).toBe('/tmp/a file.csv\r\n/tmp/b.csv');

        expect(await command[2](['get', '/tmp/a', 'file.csv'], {})).toBe('Downloaded /tmp/a file.csv');
        expect(downloader.downloadBufferAsFile).toHaveBeenCalledWith(new Uint8Array([1]), 'a file.csv');

        expect(await command[2](['drop', '/tmp/a', 'file.csv'], {})).toBe('Dropped /tmp/a file.csv');
        expect(await command[2](['list'], {})).toBe('/tmp/b.csv');
    });

    it('validates subcommands and registered paths', async () => {
        const command = createShellFilesCommand(
            new ShellFileRegistry(),
            { downloadBufferAsFile: vi.fn() },
            async () => [],
        );

        await expect(command[2](['add'], {})).resolves.toBe('No files selected');
        await expect(command[2](['unknown'], {})).rejects.toThrow('usage: .files [list|add|drop|get]');
        await expect(command[2](['get', 'missing.csv'], {})).rejects.toThrow('file not registered: missing.csv');
        await expect(command[2](['drop'], {})).rejects.toThrow('usage: .files drop <path>');
    });
});
