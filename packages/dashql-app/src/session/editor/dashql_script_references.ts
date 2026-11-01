import * as dashql from '@ankoh/dashql-core';

import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';

import { DashQLProcessorPlugin } from './dashql_processor.js';
import type { ScriptReferenceReport } from '../scripts/script_reference_check.js';

/// Set the checked script references of the script of the editor
export const DashQLScriptReferencesEffect = StateEffect.define<ScriptReferenceReport | null>();

interface ScriptReferencesState {
    /// The report of the script, null if there is none
    report: ScriptReferenceReport | null;
    /// The analyzed text version the diagnostics were built for, null if the report does not match it
    textVersion: bigint | null;
    /// The diagnostics of the analysis that `diagnostics` extends
    base: dashql.buffers.editor.EditorDiagnosticT[] | null;
    /// The diagnostics of the analysis and the errors of the script references, in text order
    diagnostics: dashql.buffers.editor.EditorDiagnosticT[] | null;
}

function referenceDiagnostics(report: ScriptReferenceReport): dashql.buffers.editor.EditorDiagnosticT[] {
    return report.marks.filter(mark => mark.errors.length > 0).map(mark => new dashql.buffers.editor.EditorDiagnosticT(
        dashql.buffers.editor.EditorDiagnosticSource.ANALYZER,
        dashql.buffers.editor.EditorDiagnosticSeverity.ERROR,
        mark.errors.join('; '),
        new dashql.buffers.editor.EditorTextSpanT(BigInt(mark.from), BigInt(mark.to - mark.from)),
    ));
}

const EMPTY: ScriptReferencesState = { report: null, textVersion: null, base: null, diagnostics: null };

/// The checked script references of the script of the editor, their errors join the diagnostics of the analysis
const ScriptReferencesField = StateField.define<ScriptReferencesState>({
    create: () => EMPTY,
    update: (prev: ScriptReferencesState, transaction: Transaction) => {
        let report = prev.report;
        for (const effect of transaction.effects) {
            if (effect.is(DashQLScriptReferencesEffect)) report = effect.value;
        }
        const processor = transaction.state.field(DashQLProcessorPlugin);
        const base = processor.editorUpdate?.diagnostics ?? null;
        const analyzed = processor.editorUpdate?.textVersion ?? null;
        // The report belongs to the analyzed text, after an edit its errors wait for the next report
        const textVersion = report != null && analyzed != null && report.textVersion === analyzed ? analyzed : null;
        if (report === prev.report && base === prev.base && textVersion === prev.textVersion) {
            return prev;
        }
        const references = report != null && textVersion != null ? referenceDiagnostics(report) : [];
        const diagnostics = references.length === 0
            ? base
            : [...(base ?? []), ...references].sort((l, r) => Number((l.textSpan?.offset ?? 0n) - (r.textSpan?.offset ?? 0n)));
        return { report, textVersion, base, diagnostics };
    },
});

/// The diagnostics of the editor: those of the analysis and the errors of the script references. The array keeps
/// its identity while neither changes.
export function editorDiagnostics(state: EditorState): dashql.buffers.editor.EditorDiagnosticT[] | null {
    const references = state.field(ScriptReferencesField, false);
    return references != null ? references.diagnostics : (state.field(DashQLProcessorPlugin).editorUpdate?.diagnostics ?? null);
}

/// The checked script references that the editor shows
export function shownScriptReferences(state: EditorState): ScriptReferenceReport | null {
    return state.field(ScriptReferencesField, false)?.report ?? null;
}

export const DashQLScriptReferencesPlugin = [ScriptReferencesField];
