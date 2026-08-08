import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { fakeButtonModule, fakeSymbolIconModule } from '../../test/view_mocks.js';

vi.mock('../foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));

import {
    type NotebookScriptsAction,
    type NotebookScripts,
    RENAME_SCRIPT,
    RENAME_SCRIPT_FOLDER,
} from '../../scripts/notebook_scripts.js';
import { NotebookFileTree } from './notebook_file_tree.js';

function createNotebookScripts(): NotebookScripts {
    return {
        scriptFolders: {
            '1_main': {
                folderName: '1_main',
                scripts: {
                    '1_query.sql': { scriptId: 1, fileName: '1_query.sql' },
                    '2_report.sql': { scriptId: 2, fileName: '2_report.sql' },
                },
            },
            '2_archive': {
                folderName: '2_archive',
                scripts: {
                    '1_old.sql': { scriptId: 3, fileName: '1_old.sql' },
                },
            },
        },
        scripts: {
            1: { annotations: { visualizeQuery: null } },
            2: { annotations: { visualizeQuery: {} } },
            3: { annotations: { visualizeQuery: null } },
        },
        scriptFocus: {
            folderName: '1_main',
            fileName: '1_query.sql',
            interactionCounter: 0,
        },
    } as unknown as NotebookScripts;
}

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function dispatchPointerEvent(target: EventTarget, type: string, clientY: number) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 0, clientY });
    Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: 1 },
    });
    target.dispatchEvent(event);
}

describe('NotebookFileTree', () => {
    let container: HTMLDivElement;
    let root: Root;
    let modifyNotebookScripts: ReturnType<typeof vi.fn<(action: NotebookScriptsAction) => void>>;
    let onSelectFolder: ReturnType<typeof vi.fn<(folder: string) => void>>;
    let onSelectScript: ReturnType<typeof vi.fn<(folder: string, file: string) => void>>;
    let onSelectCatalog: ReturnType<typeof vi.fn<(tab: 'relations' | 'functions') => void>>;
    let onAddFolder: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        modifyNotebookScripts = vi.fn();
        onSelectFolder = vi.fn();
        onSelectScript = vi.fn();
        onSelectCatalog = vi.fn();
        onAddFolder = vi.fn();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(catalogTab: 'relations' | 'functions' | null = null, navigationLevel: 'folders' | 'scripts' = 'scripts') {
        act(() => {
            root.render(
                <NotebookFileTree
                    notebookScripts={createNotebookScripts()}
                    modifyNotebookScripts={modifyNotebookScripts}
                    catalogTab={catalogTab}
                    navigationLevel={navigationLevel}
                    showCatalogEntries
                    onSelectFolder={onSelectFolder}
                    onSelectScript={onSelectScript}
                    onSelectCatalog={onSelectCatalog}
                    onAddFolder={onAddFolder}
                />,
            );
        });
    }

    it('pins catalog entries below folders and shows only the selected folder scripts', () => {
        render();

        expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Notebook files');
        expect(container.querySelector('nav')?.hasAttribute('data-notebookscripts-file-tree')).toBe(true);
        expect(container.textContent?.indexOf('Relations')).toBeGreaterThan(container.textContent!.indexOf('archive'));
        expect(container.textContent).toContain('query');
        expect(container.textContent).toContain('report');
        expect(Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === 'old')).toBe(false);
        expect(container.querySelector('[aria-label="Reorder Relations"]')).toBeNull();

        const folderButtons = Array.from(container.querySelectorAll('button'));
        act(() => folderButtons.find(candidate => candidate.textContent === 'archive')?.click());
        expect(onSelectFolder).toHaveBeenCalledWith('2_archive');

        act(() => folderButtons.find(candidate => candidate.textContent === 'report')?.click());
        expect(onSelectScript).toHaveBeenCalledWith('1_main', '2_report.sql');

        act(() => folderButtons.find(candidate => candidate.textContent === 'Relations')?.click());
        expect(onSelectCatalog).toHaveBeenCalledWith('relations');
    });

    it('collapses and expands the selected folder when clicked again', () => {
        render();
        const main = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === 'main')!;

        act(() => main.click());
        expect(Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === 'query')).toBe(false);
        expect(main.getAttribute('aria-expanded')).toBe('false');

        act(() => main.click());
        expect(Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === 'query')).toBe(true);
        expect(main.getAttribute('aria-expanded')).toBe('true');
        expect(onSelectFolder).not.toHaveBeenCalled();
    });

    it('collapses at folder level and expands at script level', () => {
        render(null, 'folders');
        expect(Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === 'query')).toBe(false);

        render(null, 'scripts');
        expect(Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === 'query')).toBe(true);
    });

    it('uses shared draggable rows without separate move controls', () => {
        render();

        expect(container.querySelector('[aria-label^="Move "]')).toBeNull();
        expect(container.querySelector('[aria-label^="Reorder "]')).toBeNull();
    });

    it('collapses the expanded folder when a folder drag starts', async () => {
        render();
        const main = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === 'main')!;

        act(() => {
            dispatchPointerEvent(main, 'pointerdown', 0);
            dispatchPointerEvent(document, 'pointermove', 8);
        });

        expect(main.getAttribute('aria-expanded')).toBe('false');
        expect(Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === 'query')).toBe(false);

        await act(async () => {
            dispatchPointerEvent(document, 'pointerup', 8);
            await new Promise(resolve => setTimeout(resolve, 60));
        });
    });

    it('renames a folder from its right-aligned action', () => {
        render();

        const renameButton = container.querySelector<HTMLButtonElement>('[aria-label="Rename main folder"]')!;
        expect(container.querySelector('[aria-label="Rename archive folder"]')).toBeNull();
        act(() => renameButton.click());

        const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename main folder"]')!;
        expect(document.activeElement).toBe(input);
        act(() => setInputValue(input, 'Analytics'));
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: RENAME_SCRIPT_FOLDER,
            value: { folderName: '1_main', newFolderName: 'Analytics' },
        });
    });

    it('cancels a folder rename with Escape', () => {
        render();

        act(() => container.querySelector<HTMLButtonElement>('[aria-label="Rename main folder"]')!.click());
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename main folder"]')!;
        act(() => {
            setInputValue(input, 'History');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });

        expect(modifyNotebookScripts).not.toHaveBeenCalled();
        expect(container.querySelector('input[aria-label="Rename main folder"]')).toBeNull();
    });

    it('renames only the selected file from its right-aligned action', () => {
        render();

        const renameButton = container.querySelector<HTMLButtonElement>('[aria-label="Rename query file"]')!;
        expect(container.querySelector('[aria-label="Rename report file"]')).toBeNull();
        act(() => renameButton.click());

        const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename query file"]')!;
        expect(document.activeElement).toBe(input);
        act(() => setInputValue(input, 'customers'));
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

        expect(modifyNotebookScripts).toHaveBeenCalledWith({
            type: RENAME_SCRIPT,
            value: { fileName: '1_query.sql', newFileName: 'customers' },
        });
    });

    it('does not start or reorder a drag from the keyboard', () => {
        render();
        const main = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === 'main')!;

        act(() => {
            main.focus();
            main.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            main.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            main.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        });

        expect(modifyNotebookScripts).not.toHaveBeenCalled();
    });

    it('marks only the active catalog entry as current', () => {
        render('relations');

        const currentButtons = container.querySelectorAll('button[aria-current="page"]');
        expect(currentButtons).toHaveLength(1);
        expect(currentButtons[0].textContent).toBe('Relations');
    });

    it('includes Add Folder', () => {
        render();

        const addFolder = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === 'Add Folder')!;
        act(() => addFolder.click());
        expect(onAddFolder).toHaveBeenCalledOnce();
    });

});
