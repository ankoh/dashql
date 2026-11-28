import * as React from 'react';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import { LoggerProvider } from '../../host/logger_provider.js';
import type { DashQLShellCommand } from './api.js';
import { useShellFiles } from './filesystem_dialog.js';
import { ShellFileRegistry } from './shell_files.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';

class FakeDatabase implements Pick<EmbeddedComputeDatabase, 'registerExternalFile' | 'removeExternalFile' | 'registerExternalDirectory' | 'removeExternalDirectory'> {
    directoryError: Error | null = null;

    async registerExternalFile(name: string): Promise<string> {
        return `/mnt/external/${name}`;
    }
    async removeExternalFile(): Promise<void> { }
    async registerExternalDirectory(handle: FileSystemDirectoryHandle, path?: string): Promise<string> {
        if (this.directoryError != null) throw this.directoryError;
        return path ?? `/mnt/external/${handle.name}`;
    }
    async removeExternalDirectory(): Promise<void> { }
}

describe('shell filesystem dialogs', () => {
    let container: HTMLDivElement;
    let root: Root;
    let database: FakeDatabase;
    let command: DashQLShellCommand;

    const Harness = () => {
        const registryRef = React.useRef(new ShellFileRegistry(new TestLogger(), database));
        const files = useShellFiles(registryRef);
        command = files.command;
        return files.dialogs;
    };

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        database = new FakeDatabase();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<LoggerProvider><Harness /></LoggerProvider>));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
        vi.unstubAllGlobals();
    });

    function runFs(signal?: AbortSignal): Promise<string | void> {
        let result!: Promise<string | void>;
        act(() => { result = Promise.resolve(command[2]([], { signal })); });
        return result;
    }
    function dialogs(): string[] {
        return Array.from(document.querySelectorAll('[role="dialog"] h2'), heading => heading.textContent ?? '');
    }
    function alerts(): string[] {
        return Array.from(document.querySelectorAll('[role="alert"]'), alert => alert.textContent ?? '');
    }
    function button(label: string): HTMLButtonElement {
        return document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    }
    function mountType(text: string): HTMLButtonElement {
        return Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Mount type"] button'))
            .find(item => item.textContent === text)!;
    }
    function click(element: HTMLElement) {
        act(() => element.click());
    }
    function mountButton(): HTMLButtonElement {
        return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === 'Mount')!;
    }

    it('keeps the mount dialog open when the folder picker is closed, closing it settles .fs', async () => {
        vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError')));
        const fs = runFs();
        expect(dialogs()).toEqual(['Filesystem']);
        click(button('Mount filesystem entry'));
        expect(dialogs()).toEqual(['Filesystem Mount']);

        click(mountType('FolderREAD'));
        // The closed picker chose nothing, the dialog stays without an error
        await waitForRender(() => { });
        expect(dialogs()).toEqual(['Filesystem Mount']);
        expect(alerts()).toEqual([]);

        click(button('Close filesystem mount'));
        await waitForRender(() => expect(dialogs()).toEqual([]));
        await expect(fs).resolves.toBeUndefined();
    });

    it('shows a failed mount in the mount dialog and returns to the filesystem dialog after a mount', async () => {
        vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue({ name: 'data' }));
        database.directoryError = new Error('access denied');
        const fs = runFs();
        click(button('Mount filesystem entry'));
        click(mountType('FolderREAD/WRITE'));
        await waitForRender(() => expect(dialogs()).toEqual(['Mount Path']));
        expect(alerts()).toEqual([]);

        click(mountButton());
        await waitForRender(() => expect(alerts()).toEqual(['access denied']));
        expect(dialogs()).toEqual(['Mount Path']);

        database.directoryError = null;
        click(mountButton());
        await waitForRender(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('/mnt/external/data'));
        expect(dialogs()).toEqual(['Filesystem']);

        click(button('Close filesystem'));
        await expect(fs).resolves.toBeUndefined();
    });

    it('closes both dialogs when the command is aborted', async () => {
        const abort = new AbortController();
        const fs = runFs(abort.signal);
        click(button('Mount filesystem entry'));
        expect(dialogs()).toEqual(['Filesystem Mount']);

        act(() => abort.abort());
        await waitForRender(() => expect(dialogs()).toEqual([]));
        await expect(fs).resolves.toBeUndefined();
        // The next .fs opens the dialog again
        await waitForRender(() => { });
        const next = runFs();
        expect(dialogs()).toEqual(['Filesystem']);
        click(button('Close filesystem'));
        await expect(next).resolves.toBeUndefined();
    });
});
