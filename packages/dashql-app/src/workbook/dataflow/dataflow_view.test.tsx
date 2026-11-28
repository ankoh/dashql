import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { DataflowView, type DataflowViewProps } from './dataflow_view.js';
import { scriptSelectionOf } from '../scripts/script_selection.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// The props of a slot of the view
type SlotProps<K extends 'canvas' | 'editorDialog'> = Parameters<NonNullable<DataflowViewProps[K]>>[0];

/// A workbook with two scripts, only the fields that the view reads
function workbook(workbookId: string, fileNames: string[] = ['alpha.sql', 'beta.sql']): WorkbookScripts {
    const scriptKeys = fileNames.map((_, index) => index + 1);
    return {
        workbookId,
        scriptOrder: fileNames,
        scriptKeys,
        scriptRefs: Object.fromEntries(fileNames.map((fileName, index) => [fileName, { scriptId: scriptKeys[index], fileName }])),
    } as unknown as WorkbookScripts;
}

describe('DataflowView', () => {
    let root: ReturnType<typeof createTestRoot>;
    /// The props of the last render of the stand-ins of the slots
    let canvas: SlotProps<'canvas'> | null;
    let dialog: SlotProps<'editorDialog'> | null;
    const show = (workbookScripts: WorkbookScripts) => root.render(
        <DataflowView workbookScripts={workbookScripts} modifyWorkbookScripts={vi.fn()} scriptConnections={new Map()}
            canvas={props => { canvas = props; return <div data-testid="dataflow" />; }}
            editorDialog={props => { dialog = props; return <div data-testid="script-editor-dialog" />; }} />,
    );
    const dialogShown = () => root.container.querySelector('[data-testid="script-editor-dialog"]') != null;

    beforeEach(() => {
        canvas = null;
        dialog = null;
        root = createTestRoot();
    });
    afterEach(() => root.unmount());

    it('opens a script of the canvas in the editor dialog and selects it', async () => {
        await show(workbook('w'));
        expect(root.container.querySelector('[data-testid="dataflow"]')).not.toBeNull();
        expect(dialogShown()).toBe(false);
        act(() => canvas!.onInspect!(2));
        expect(dialogShown()).toBe(true);
        expect(dialog?.scriptKey).toBe(2);
        // The commands of the workbook run the selected script
        expect(scriptSelectionOf(null).store.current.get('w')).toBe(2);
        // A script that the dialog references opens in it
        act(() => dialog!.onNavigateToScript!(1));
        expect(dialog?.scriptKey).toBe(1);
        act(() => dialog!.onClose());
        expect(dialogShown()).toBe(false);
    });

    it('closes the editor dialog when another workbook shows', async () => {
        await show(workbook('w'));
        act(() => canvas!.onInspect!(1));
        expect(dialogShown()).toBe(true);
        await show(workbook('other'));
        expect(dialogShown()).toBe(false);
        // Coming back does not reopen the dialog
        await show(workbook('w'));
        expect(dialogShown()).toBe(false);
    });

    it('closes the editor dialog when its script is gone', async () => {
        await show(workbook('w'));
        act(() => canvas!.onInspect!(2));
        expect(dialogShown()).toBe(true);
        await show(workbook('w', ['alpha.sql']));
        expect(dialogShown()).toBe(false);
    });
});
