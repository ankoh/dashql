import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageBrowserView } from './storage_browser_view.js';
import * as styles from './storage_browser_view.module.css';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { OPFS_TESTS_FOLDER } from '../../platform/opfs_root.js';
import { OPFSDirectoryMock } from '../../tests/opfs_mock.js';
import { createTestRoot } from '../../tests/react_root.js';

describe('StorageBrowserView', () => {
    let root: ReturnType<typeof createTestRoot>;
    let files: Map<string, string | ArrayBuffer>;
    let dirs: Set<string>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;
    let getDirectory: ReturnType<typeof vi.spyOn<StorageManager, 'getDirectory'>>;

    /// Put a file into the OPFS folder of the tests, which the view browses
    const putFile = (path: string, text: string) => files.set(`${OPFS_TESTS_FOLDER}/${path}`, text);
    const putDir = (path: string) => dirs.add(`${OPFS_TESTS_FOLDER}/${path}`);

    beforeEach(() => {
        root = createTestRoot();
        root.container.style.width = '800px';
        root.container.style.height = '600px';
        root.container.style.display = 'flex';
        files = new Map();
        dirs = new Set([OPFS_TESTS_FOLDER]);
        onClose = vi.fn<() => void>();
        const opfs = new OPFSDirectoryMock('', files, dirs);
        getDirectory = vi.spyOn(navigator.storage, 'getDirectory').mockImplementation(async () => opfs as unknown as FileSystemDirectoryHandle);
    });

    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    async function render() {
        await root.render(
            <LoggerProvider>
                <StorageProvider backend={new SessionTestBackend()}>
                    <StorageBrowserView onClose={onClose} />
                </StorageProvider>
            </LoggerProvider>,
        );
    }

    /// The rows as `<depth> [+|-]<name> (<size>)`, + marks collapsed and - expanded folders
    const rows = () => [...root.container.querySelectorAll<HTMLElement>(`.${styles.row_container}`)].map(row => {
        const entry = row.firstElementChild as HTMLElement;
        const depth = (Number.parseInt(entry.style.paddingLeft, 10) - 8) / 16;
        const expanded = entry.getAttribute('aria-expanded');
        const marker = expanded == null ? '' : expanded === 'true' ? '-' : '+';
        const name = entry.querySelector('[title]')?.textContent ?? '';
        const size = entry.querySelector(`div.${styles.cell_size}`)?.textContent;
        return `${depth} ${marker}${name}${size ? ` (${size})` : ''}`;
    });
    const row = (name: string) => [...root.container.querySelectorAll<HTMLButtonElement>(`.${styles.row_container} button`)]
        .find(entry => entry.querySelector('[title]')?.textContent === name)!;
    const button = (label: string) => root.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const textButton = (text: string) => [...root.container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;

    it('lists the folders on expansion', async () => {
        putDir('sessions');
        putDir('sessions/s1');
        putDir('sessions/empty');
        putFile('sessions/s1/notes.sql', 'select 1');
        putFile('stray.txt', 'hello');
        await render();

        expect(root.container.textContent).toContain('opfs://');
        await vi.waitFor(() => expect(rows()).toEqual([
            '0 -Origin Private File System',
            '1 +sessions',
            '1 stray.txt (5 bytes)',
        ]));
        // The modification time of a file is shown relative to now
        expect(root.container.querySelector(`.${styles.cell_modified}[title]`)?.getAttribute('title')).toMatch(/^\d{4}-/);

        act(() => row('sessions').click());
        await vi.waitFor(() => expect(rows()).toEqual([
            '0 -Origin Private File System',
            '1 -sessions',
            '2 +empty',
            '2 +s1',
            '1 stray.txt (5 bytes)',
        ]));
        act(() => row('s1').click());
        act(() => row('empty').click());
        await vi.waitFor(() => expect(rows()).toEqual([
            '0 -Origin Private File System',
            '1 -sessions',
            '2 -empty',
            '3 Empty',
            '2 -s1',
            '3 notes.sql (8 bytes)',
            '1 stray.txt (5 bytes)',
        ]));

        // Collapsing keeps the listings
        act(() => row('sessions').click());
        expect(rows()).toEqual([
            '0 -Origin Private File System',
            '1 +sessions',
            '1 stray.txt (5 bytes)',
        ]);
        act(() => row('Origin Private File System').click());
        expect(rows()).toEqual(['0 +Origin Private File System']);

        act(() => button('close-overlay').click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('lists the folders again on a refresh and shows listing errors', async () => {
        putDir('gone');
        putFile('a.txt', 'a');
        await render();
        await vi.waitFor(() => expect(rows()).toEqual(['0 -Origin Private File System', '1 +gone', '1 a.txt (1 byte)']));

        // The listing of a folder that was removed fails
        dirs.delete(`${OPFS_TESTS_FOLDER}/gone`);
        act(() => row('gone').click());
        await vi.waitFor(() => expect(rows()).toEqual([
            '0 -Origin Private File System',
            '1 -gone',
            '2 not found',
            '1 a.txt (1 byte)',
        ]));
        expect(root.container.querySelector(`.${styles.status_error}`)?.textContent).toBe('not found');

        putFile('b.txt', 'bb');
        await act(async () => button('Refresh storage listing').click());
        await vi.waitFor(() => expect(rows()).toEqual([
            '0 -Origin Private File System',
            '1 a.txt (1 byte)',
            '1 b.txt (2 bytes)',
        ]));
    });

    it('deletes the entries that the app does not use once confirmed', async () => {
        putDir('old');
        putFile('old/data.bin', 'x');
        putFile('stray.txt', 'hello');
        await render();
        await vi.waitFor(() => expect(rows()).toEqual(['0 -Origin Private File System', '1 +old', '1 stray.txt (5 bytes)']));

        const reviewed = () => [...root.container.querySelectorAll<HTMLElement>(`.${styles.row_container}`)]
            .map(r => [...r.querySelectorAll('[title]')].map(cell => cell.getAttribute('title')));

        // Declining keeps the entries
        await act(async () => button('Check the filesystem').click());
        await vi.waitFor(() => expect(root.container.textContent).toContain("Delete 2 entries that this version of DashQL doesn't use?"));
        expect(reviewed()).toEqual([
            ['old/', 'Not used by this version of DashQL'],
            ['stray.txt', 'Not used by this version of DashQL'],
        ]);
        expect(root.container.textContent).toContain('Reason');
        expect(button('Check the filesystem').disabled).toBe(true);
        expect(button('Refresh storage listing').disabled).toBe(true);
        act(() => textButton('No').click());
        expect(root.container.textContent).not.toContain('Delete 2 entries');
        expect(files.has(`${OPFS_TESTS_FOLDER}/stray.txt`)).toBe(true);

        await act(async () => button('Check the filesystem').click());
        await vi.waitFor(() => expect(textButton('Yes, delete')).toBeDefined());
        await act(async () => textButton('Yes, delete').click());
        await vi.waitFor(() => expect(root.container.textContent).toContain('Deleted 2 entries.'));
        expect([...files.keys()]).toEqual([]);
        expect([...dirs]).toEqual([OPFS_TESTS_FOLDER]);
        // The tree is listed again
        await vi.waitFor(() => expect(rows()).toEqual(['0 -Origin Private File System', '1 Empty']));

        act(() => button('Dismiss cleanup message').click());
        expect(root.container.textContent).not.toContain('Deleted 2 entries.');

        // Nothing left to clean up
        await act(async () => button('Check the filesystem').click());
        await vi.waitFor(() => expect(root.container.textContent).toContain('Nothing to clean up.'));
    });

    it('reports a failed scan', async () => {
        await render();
        await vi.waitFor(() => expect(rows()).toEqual(['0 -Origin Private File System', '1 Empty']));
        getDirectory.mockRejectedValue(new Error('opfs unavailable'));
        await act(async () => button('Check the filesystem').click());
        await vi.waitFor(() => expect(root.container.textContent).toContain('Scan failed: opfs unavailable'));
        expect(root.container.querySelector(`.${styles.cleanup_message_warning}`)?.textContent).toBe('Scan failed: opfs unavailable');
        expect(button('Check the filesystem').disabled).toBe(false);
    });
});
