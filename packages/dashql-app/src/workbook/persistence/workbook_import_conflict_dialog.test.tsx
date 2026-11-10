import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkbookImportCardDependencies } from './workbook_import_card.js';
import { WorkbookImportConflictDialog, type WorkbookImportConflictDialogProps } from './workbook_import_conflict_dialog.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});

const dependencies: WorkbookImportCardDependencies = {
    CompactNavBar: () => <></>,
};

const DETAILS = {
    workbookName: 'Quarterly pipeline',
    workbookUuid: '4f741f53-d76f-4a6d-b1d8-c22aa85bd449',
    existingDisplayLocation: 'Local workbooks / Sales',
    existingIsNative: false,
    folderCount: 2,
    scriptCount: 4,
};

function button(testId: string): HTMLButtonElement {
    const result = document.querySelector(`[data-testid="${testId}"]`);
    if (!(result instanceof HTMLButtonElement)) throw new Error(`No button with test id "${testId}"`);
    return result;
}

describe('WorkbookImportConflictDialog', () => {
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

    function render(props: Partial<Extract<WorkbookImportConflictDialogProps, { mode: 'centered' }>> = {}) {
        act(() => root.render(
            <WorkbookImportConflictDialog
                mode="centered"
                {...DETAILS}
                busy={false}
                onReplace={onReplace}
                onCreateNew={onCreateNew}
                onCancel={onCancel}
                dependencies={dependencies}
                {...props}
            />,
        ));
    }

    it('renders a page-level conflict card with workbook details', () => {
        render();

        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('[data-testid="workbook-import-conflict"]')).not.toBeNull();
        expect(container.textContent).toContain(DETAILS.workbookName);
        expect(container.textContent).toContain(DETAILS.workbookUuid);
        expect(container.textContent).toContain(DETAILS.existingDisplayLocation);
        expect(button('workbook-import-replace')).toBeInstanceOf(HTMLButtonElement);
        expect(button('workbook-import-create-new')).toBeInstanceOf(HTMLButtonElement);
        expect(button('dialog-close')).toBeInstanceOf(HTMLButtonElement);
    });

    it('does not auto-focus an action and invokes each action', () => {
        render();

        expect(document.activeElement).toBe(document.body);
        act(() => button('workbook-import-replace').click());
        act(() => button('workbook-import-create-new').click());
        act(() => button('dialog-close').click());

        expect(onReplace).toHaveBeenCalledOnce();
        expect(onCreateNew).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('does not behave like a dismissible modal', () => {
        render();

        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onCancel).not.toHaveBeenCalled();
    });

    it('disables actions while busy', () => {
        render({ busy: true });

        expect(container.querySelector('[data-testid="workbook-import-card"]')?.getAttribute('aria-busy')).toBe('true');
        expect(button('workbook-import-replace').disabled).toBe(true);
        expect(button('workbook-import-create-new').disabled).toBe(true);
        expect(button('dialog-close').disabled).toBe(true);

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
            <WorkbookImportConflictDialog
                mode="anchored"
                anchorRef={anchorRef}
                returnFocusRef={returnFocusRef}
                {...DETAILS}
                busy={false}
                onReplace={onReplace}
                onCreateNew={onCreateNew}
                onCancel={onCancel}
                dependencies={dependencies}
            />,
        ));

        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.activeElement).not.toBe(button('workbook-import-create-new'));

        act(() => root.unmount());
        expect(document.activeElement).toBe(returnFocus);
        root = createRoot(container);
        anchor.remove();
        returnFocus.remove();
    });
});
