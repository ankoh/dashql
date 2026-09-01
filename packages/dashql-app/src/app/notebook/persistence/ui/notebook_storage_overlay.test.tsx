import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = vi.hoisted(() => ({
    modifyNotebookScripts: vi.fn(),
    parentKeyDown: vi.fn(),
}));

vi.mock('../storage_provider.js', () => ({
    useStorageReader: () => ({
        backend: {},
        getNotebookLocation: () => ({ type: 0 }),
    }),
    useStorageWriter: () => ({}),
}));
vi.mock('../../scripts/notebook_scripts_registry.js', () => ({
    useNotebookScripts: () => [{ name: 'Original name' }, state.modifyNotebookScripts],
}));
vi.mock('../../../../platform/logger/logger_provider.js', () => ({
    useLogger: () => ({}),
}));

import { RENAME_NOTEBOOK } from '../../scripts/notebook_scripts.js';
import { NotebookStorageViewer } from './notebook_storage_overlay.js';

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('NotebookStorageViewer notebook name', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.modifyNotebookScripts.mockReset();
        state.parentKeyDown.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(
            <div onKeyDown={state.parentKeyDown}>
                <NotebookStorageViewer notebookId="notebook" onClose={vi.fn()} />
            </div>,
        ));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function nameInput(): HTMLInputElement {
        return container.querySelector('[aria-label="Notebook name"]') as HTMLInputElement;
    }

    it('does not rename while typing and commits when the input is dismissed', () => {
        const input = nameInput();
        act(() => {
            input.focus();
            setInputValue(input, 'Updated name');
        });

        expect(state.modifyNotebookScripts).not.toHaveBeenCalled();

        act(() => input.blur());
        expect(state.modifyNotebookScripts).toHaveBeenCalledOnce();
        expect(state.modifyNotebookScripts).toHaveBeenCalledWith({
            type: RENAME_NOTEBOOK,
            value: 'Updated name',
        });
    });

    it('commits on Enter', () => {
        const input = nameInput();
        act(() => {
            input.focus();
            setInputValue(input, 'Updated name');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        expect(state.modifyNotebookScripts).toHaveBeenCalledOnce();
        expect(state.modifyNotebookScripts).toHaveBeenCalledWith({
            type: RENAME_NOTEBOOK,
            value: 'Updated name',
        });
    });

    it('keeps text-entry keys inside the name input', () => {
        const input = nameInput();

        act(() => {
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        });

        expect(state.parentKeyDown).not.toHaveBeenCalled();
    });

    it('cancels on Escape without renaming', () => {
        const input = nameInput();
        act(() => {
            input.focus();
            setInputValue(input, 'Updated name');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });

        expect(input.value).toBe('Original name');
        expect(state.modifyNotebookScripts).not.toHaveBeenCalled();
    });
});
