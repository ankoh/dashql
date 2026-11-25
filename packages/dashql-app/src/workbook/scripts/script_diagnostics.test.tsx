import * as React from 'react';
import * as dashql from '@akohn/dashql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { collectScriptDiagnostics, ScriptDiagnosticsButton, SCRIPT_FORMATTING_WARNING } from './script_diagnostics.js';
import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const { EditorDiagnosticSeverity, EditorDiagnosticSource, EditorDiagnosticT, EditorTextSpanT } = dashql.buffers.editor;

function diagnostic(severity: dashql.buffers.editor.EditorDiagnosticSeverity, source: dashql.buffers.editor.EditorDiagnosticSource, message: string, span: [number, number] | null = null) {
    return new EditorDiagnosticT(source, severity, message, span == null ? null : new EditorTextSpanT(BigInt(span[0]), BigInt(span[1])));
}

function scriptData(diagnostics: dashql.buffers.editor.EditorDiagnosticT[], isFullyFormattable: (config: dashql.buffers.formatting.FormattingConfigT) => boolean = () => false): ScriptData {
    return {
        scriptKey: 3,
        editorUpdate: { diagnostics, textVersion: 2n },
        scriptSession: { isFullyFormattable },
    } as unknown as ScriptData;
}

function references(textVersion: bigint): ScriptReferenceReport {
    return {
        textVersion,
        marks: [{ from: 10, to: 14, errors: ['unknown script: orders'] }],
    } as unknown as ScriptReferenceReport;
}

describe('collectScriptDiagnostics', () => {
    it('maps the editor diagnostics, the reference errors and the formatting warning', () => {
        const script = scriptData([
            diagnostic(EditorDiagnosticSeverity.ERROR, EditorDiagnosticSource.PARSER, 'syntax error', [4, 3]),
            diagnostic(EditorDiagnosticSeverity.WARNING, EditorDiagnosticSource.ANALYZER, 'unresolved column'),
        ]);
        const result = collectScriptDiagnostics(script, false, ConnectorType.TRINO, null, references(2n));
        expect(result.map(d => [d.severity, d.message, d.offset])).toEqual([
            ['error', 'syntax error', 4],
            ['warning', 'unresolved column', null],
            ['error', 'unknown script: orders', 10],
            ['warning', SCRIPT_FORMATTING_WARNING, null],
        ]);
        expect(result[0].details).toEqual({
            source: 'parser', severity: 'error', message: 'syntax error', scriptKey: 3, textSpan: { offset: 4, length: 3, end: 7 },
        });
        expect(result[1].details.textSpan).toBeNull();
        expect(result[2].details).toEqual({
            source: 'script references', severity: 'error', message: 'unknown script: orders', scriptKey: 3,
            textSpan: { offset: 10, length: 4, end: 14 },
        });
        // The formatter is inspected with the dialect of the connector
        expect(result[3].details).toMatchObject({
            source: 'formatter',
            configuration: { dialect: 'TRINO' },
            fullyFormattable: false,
        });
    });

    it('skips the references of an older text and passes given formatting details', () => {
        const script = scriptData([]);
        expect(collectScriptDiagnostics(script, true, undefined, null, references(1n))).toEqual([]);
        const formatting = { source: 'cached' };
        expect(collectScriptDiagnostics(script, false, undefined, formatting)).toEqual([
            { severity: 'warning', message: SCRIPT_FORMATTING_WARNING, offset: null, details: formatting },
        ]);
        // A script without an update has no diagnostics
        expect(collectScriptDiagnostics({ ...script, editorUpdate: null } as unknown as ScriptData, true)).toEqual([]);
    });

    it('reports a failing formatter inspection', () => {
        const script = scriptData([], () => { throw new Error('no formatter'); });
        const [warning] = collectScriptDiagnostics(script, false, ConnectorType.HYPER);
        expect(warning.details).toMatchObject({ configuration: { dialect: 'HYPER' }, inspectionError: 'no formatter' });
        expect(warning.details.fullyFormattable).toBeUndefined();
    });
});

describe('ScriptDiagnosticsButton', () => {
    let root: ReturnType<typeof createTestRoot>;

    beforeEach(() => {
        root = createTestRoot();
    });
    afterEach(() => root.unmount());

    const trigger = () => root.container.querySelector<HTMLButtonElement>('button[data-testid="script-diagnostics"]');
    const dialog = (label: string) => document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${label}"]`);

    it('renders nothing without diagnostics', () => {
        root.render(<ScriptDiagnosticsButton scriptData={scriptData([])} isFormattable />);
        expect(root.container.innerHTML).toBe('');
    });

    it('lists the errors and warnings and shows the details of one', () => {
        const script = scriptData([
            diagnostic(EditorDiagnosticSeverity.ERROR, EditorDiagnosticSource.SCANNER, 'unterminated string', [0, 5]),
            diagnostic(EditorDiagnosticSeverity.ERROR, EditorDiagnosticSource.PARSER, 'syntax error'),
        ]);
        root.render(<ScriptDiagnosticsButton scriptData={script} isFormattable={false} connectorType={ConnectorType.HYPER} />);
        // Errors show with their count
        expect(trigger()!.getAttribute('aria-label')).toBe('Show 2 errors, 1 warning');
        expect(trigger()!.dataset.severity).toBe('error');
        expect(trigger()!.textContent).toBe('2');
        expect(dialog('Script diagnostics')).toBeNull();

        act(() => trigger()!.click());
        const list = dialog('Script diagnostics')!;
        expect(list.textContent).toContain('2 errors, 1 warning');
        expect([...list.querySelectorAll('li')].map(item => item.textContent)).toEqual([
            'unterminated string', 'syntax error', SCRIPT_FORMATTING_WARNING,
        ]);

        act(() => list.querySelector<HTMLButtonElement>('button[aria-label="Show details: unterminated string"]')!.click());
        expect(dialog('Script diagnostics')).toBeNull();
        const details = dialog('Diagnostic details')!;
        expect(details.textContent).toContain('scanner');
        expect(details.textContent).toContain('unterminated string');

        act(() => details.querySelector<HTMLButtonElement>('button[aria-label="Close diagnostic details"]')!.click());
        expect(dialog('Diagnostic details')).toBeNull();
    });

    it('shows a warning trigger and closes when the diagnostics are gone', () => {
        const warning = scriptData([diagnostic(EditorDiagnosticSeverity.WARNING, EditorDiagnosticSource.ANALYZER, 'ambiguous column')]);
        root.render(<ScriptDiagnosticsButton scriptData={warning} isFormattable />);
        expect(trigger()!.getAttribute('aria-label')).toBe('Show 1 warning');
        expect(trigger()!.dataset.severity).toBe('warning');
        act(() => trigger()!.click());
        expect(dialog('Script diagnostics')!.textContent).toContain('1 warning');
        expect(dialog('Script diagnostics')!.textContent).not.toContain('error');

        // A fixed script hides the trigger and the list
        root.render(<ScriptDiagnosticsButton scriptData={scriptData([])} isFormattable />);
        expect(trigger()).toBeNull();
        expect(dialog('Script diagnostics')).toBeNull();

        // The list stays closed when the warning comes back
        root.render(<ScriptDiagnosticsButton scriptData={warning} isFormattable />);
        expect(trigger()).not.toBeNull();
        expect(dialog('Script diagnostics')).toBeNull();
    });

    it('shows the reference errors of the current text', () => {
        const script = scriptData([]);
        root.render(<ScriptDiagnosticsButton scriptData={script} isFormattable references={references(1n)} />);
        expect(trigger()).toBeNull();
        root.render(<ScriptDiagnosticsButton scriptData={script} isFormattable references={references(2n)} iconSize={12} />);
        act(() => trigger()!.click());
        expect(dialog('Script diagnostics')!.textContent).toContain('1 error');
        expect(dialog('Script diagnostics')!.textContent).toContain('unknown script: orders');
    });

    it('moves the cursor of the editor to a diagnostic and still shows its details', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({ parent, state: EditorState.create({ doc: 'select 1;\nselect * fromm x;' }) });
        try {
            const script = scriptData([
                diagnostic(EditorDiagnosticSeverity.ERROR, EditorDiagnosticSource.PARSER, 'syntax error', [24, 1]),
                diagnostic(EditorDiagnosticSeverity.WARNING, EditorDiagnosticSource.ANALYZER, 'somewhere'),
            ]);
            root.render(<ScriptDiagnosticsButton scriptData={script} isFormattable editorView={view} />);
            act(() => trigger()!.click());
            const list = dialog('Script diagnostics')!;
            // A diagnostic with a place shows where it is, the other one only its details
            expect(list.querySelector('button[aria-label="Go to: syntax error"]')!.textContent).toBe('syntax errorLn 2, Col 15');
            expect(list.querySelector('button[aria-label="Show details: somewhere"]')).not.toBeNull();

            act(() => list.querySelector<HTMLButtonElement>('button[aria-label="Go to: syntax error"]')!.click());
            expect(dialog('Script diagnostics')).toBeNull();
            expect(view.state.selection.main.head).toBe(24);

            act(() => trigger()!.click());
            act(() => dialog('Script diagnostics')!.querySelector<HTMLButtonElement>('button[aria-label="Show details: syntax error"]')!.click());
            expect(dialog('Diagnostic details')!.textContent).toContain('parser');
        } finally {
            view.destroy();
            parent.remove();
        }
    });
});
