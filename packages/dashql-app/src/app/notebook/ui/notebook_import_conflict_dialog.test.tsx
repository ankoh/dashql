import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});

import { NotebookImportConflictDialog, type NotebookImportConflictDialogProps } from './notebook_import_conflict_dialog.js';

const DETAILS = {
    notebookName: 'Quarterly pipeline',
    notebookUuid: '4f741f53-d76f-4a6d-b1d8-c22aa85bd449',
    existingDisplayLocation: 'Local notebooks / Sales',
};

function button(name: string): HTMLButtonElement {
    const result = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent === name);
    if (!(result instanceof HTMLButtonElement)) throw new Error(`No button named "${name}"`);
    return result;
}

describe('NotebookImportConflictDialog', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onReplace: ReturnType<typeof vi.fn<() => void>>;
    let onCreateNew: ReturnType<typeof vi.fn<() => void>>;
    let onCancel: ReturnType<typeof vi.fn<() => void>>;
    let mounted: boolean;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mounted = true;
        onReplace = vi.fn<() => void>();
        onCreateNew = vi.fn<() => void>();
        onCancel = vi.fn<() => void>();
    });

    afterEach(() => {
        if (mounted) act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    function render(props: Partial<Extract<NotebookImportConflictDialogProps, { mode: 'centered' }>> = {}) {
        act(() => root.render(
            <NotebookImportConflictDialog
                mode="centered"
                {...DETAILS}
                busy={false}
                onReplace={onReplace}
                onCreateNew={onCreateNew}
                onCancel={onCancel}
                {...props}
            />,
        ));
    }

    it('renders a named and described modal dialog with conflict details', () => {
        render();

        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
        const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
        const description = document.getElementById(dialog.getAttribute('aria-describedby')!);

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(title?.textContent).toBe('Notebook already exists');
        expect(description?.textContent).toContain('different UUID');
        expect(dialog.textContent).toContain(DETAILS.notebookName);
        expect(dialog.textContent).toContain(DETAILS.notebookUuid);
        expect(dialog.textContent).toContain(DETAILS.existingDisplayLocation);
        expect(button('Replace')).toBeInstanceOf(HTMLButtonElement);
        expect(button('Create new')).toBeInstanceOf(HTMLButtonElement);
        expect(button('Cancel')).toBeInstanceOf(HTMLButtonElement);
    });

    it('focuses Create new and invokes each action', () => {
        render();

        expect(document.activeElement).toBe(button('Create new'));
        act(() => button('Replace').click());
        act(() => button('Create new').click());
        act(() => button('Cancel').click());

        expect(onReplace).toHaveBeenCalledOnce();
        expect(onCreateNew).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('cancels on Escape and outside click', () => {
        render();

        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onCancel).toHaveBeenCalledTimes(2);
    });

    it('restores focus after a centered dialog unmounts', () => {
        const previous = document.createElement('button');
        document.body.append(previous);
        previous.focus();
        render();
        expect(document.activeElement).toBe(button('Create new'));

        act(() => root.unmount());
        mounted = false;

        expect(document.activeElement).toBe(previous);
        previous.remove();
    });

    it('marks the dialog busy, disables actions, and blocks dismissal', () => {
        render({ busy: true });

        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-busy')).toBe('true');
        expect(button('Replace').disabled).toBe(true);
        expect(button('Create new').disabled).toBe(true);
        expect(button('Cancel').disabled).toBe(true);

        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onCancel).not.toHaveBeenCalled();
        expect(onReplace).not.toHaveBeenCalled();
        expect(onCreateNew).not.toHaveBeenCalled();
    });

    it('supports anchored placement and restores explicit return focus', () => {
        const anchor = document.createElement('div');
        const returnFocus = document.createElement('button');
        document.body.append(anchor, returnFocus);
        const anchorRef = { current: anchor };
        const returnFocusRef = { current: returnFocus };

        act(() => root.render(
            <NotebookImportConflictDialog
                mode="anchored"
                anchorRef={anchorRef}
                returnFocusRef={returnFocusRef}
                {...DETAILS}
                busy={false}
                onReplace={onReplace}
                onCreateNew={onCreateNew}
                onCancel={onCancel}
            />,
        ));

        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.activeElement).toBe(button('Create new'));

        act(() => root.unmount());
        expect(document.activeElement).toBe(returnFocus);
        root = createRoot(container);
        anchor.remove();
        returnFocus.remove();
    });
});
