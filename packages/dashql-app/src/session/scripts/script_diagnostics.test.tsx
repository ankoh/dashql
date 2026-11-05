import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from '@dashql/browser-test-act';
import { createTestRoot } from '../../tests/react_root.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { collectScriptDiagnostics, ScriptDiagnosticsButton, SCRIPT_FORMATTING_WARNING } from './script_diagnostics.js';
import type { ScriptData } from './session_scripts.js';
import type { ScriptReferenceReport } from './script_reference_check.js';

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
        expect(result.map(d => [d.severity, d.message])).toEqual([
            ['error', 'syntax error'],
            ['warning', 'unresolved column'],
            ['error', 'unknown script: orders'],
            ['warning', SCRIPT_FORMATTING_WARNING],
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
            configuration: { dialect: 'TRINO', mode: 'PRETTY', maxWidth: 80, indentationWidth: 4 },
            fullyFormattable: false,
        });
    });

    it('skips the references of an older text and passes given formatting details', () => {
        const script = scriptData([]);
        expect(collectScriptDiagnostics(script, true, undefined, null, references(1n))).toEqual([]);
        const formatting = { source: 'cached' };
        expect(collectScriptDiagnostics(script, false, undefined, formatting)).toEqual([
            { severity: 'warning', message: SCRIPT_FORMATTING_WARNING, details: formatting },
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

    const trigger = () => root.container.querySelector<HTMLButtonElement>('button[aria-label^="Show script"]');
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
        expect(trigger()!.getAttribute('aria-label')).toBe('Show script errors');
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
        expect(trigger()!.getAttribute('aria-label')).toBe('Show script warnings');
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
});
