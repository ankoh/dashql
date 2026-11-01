import * as core from '@ankoh/dashql-core';

import { sessionPlanRequest } from '../inputs/session_inputs.js';
import { orderedSessionScripts, type SessionScripts } from './session_scripts.js';

const NONE = 0xFFFFFFFF;

/// What a script reference reads
enum ScriptReferenceKind {
    /// The query of the referenced script is inlined into the statement, both run on one connection
    Inline = 'inline',
    /// The statement scans the result of a script of another connection, materialized as Parquet file
    Scan = 'scan',
    /// The reference has errors
    Invalid = 'invalid',
    /// The statement scans an attachment of the session
    Attachment = 'attachment',
}

/// A checked table parameter of a script, `:foo`
interface ScriptReferenceMark {
    /// The begin of the parameter, at the prefix, in UTF-16 code units
    from: number;
    /// The end of the parameter
    to: number;
    /// The parameter name
    parameter: string;
    /// The file name of the referenced script, null if the name finds none
    target: string | null;
    /// The index of the referenced attachment, null if the name finds none
    attachment: number | null;
    /// What the reference reads
    kind: ScriptReferenceKind;
    /// The errors of the reference
    errors: string[];
}

/// The checked script references of a script
export interface ScriptReferenceReport {
    /// The text version of the analysis that was checked, the marks lie in that text
    textVersion: bigint;
    /// The table parameters in text order
    marks: ScriptReferenceMark[];
}

/// Check the script references of every script of a session, by script key. A script whose analysis is not current
/// with its text has no report.
export function computeScriptReferenceReports(session: SessionScripts): Map<number, ScriptReferenceReport> {
    const scripts = orderedSessionScripts(session);
    const reports = new Map<number, ScriptReferenceReport>();
    if (scripts.length === 0) return reports;
    const check: core.buffers.execution.ScriptReferenceCheckT = session.instance.checkScriptReferences(
        sessionPlanRequest(scripts, scripts.map(script => script.fileName)),
    ).unpack();
    check.scripts.forEach((checked, index) => {
        if (!checked.checked) return;
        const marks = checked.references.map(reference => {
            const span = reference.textSpan;
            const from = span?.offset ?? 0;
            let kind: ScriptReferenceKind;
            if (reference.errors.length > 0 || reference.kind === core.buffers.execution.ScriptReferenceKind.INVALID) {
                kind = ScriptReferenceKind.Invalid;
            } else if (reference.kind === core.buffers.execution.ScriptReferenceKind.SCAN) {
                kind = ScriptReferenceKind.Scan;
            } else if (reference.kind === core.buffers.execution.ScriptReferenceKind.ATTACHMENT) {
                kind = ScriptReferenceKind.Attachment;
            } else {
                kind = ScriptReferenceKind.Inline;
            }
            return {
                from,
                to: from + (span?.length ?? 0),
                parameter: String(reference.parameter ?? ''),
                target: reference.script !== NONE ? scripts[reference.script]?.fileName ?? null : null,
                attachment: reference.attachment !== NONE ? reference.attachment : null,
                kind,
                errors: reference.errors.map(String),
            };
        });
        reports.set(scripts[index].scriptKey, { textVersion: checked.textVersion, marks });
    });
    return reports;
}

/// A change of the text of a script, in UTF-16 code units of the text before the change
export interface ScriptTextChange {
    from: number;
    to: number;
    insert: string;
}

/// The changes that rename the references to a script: every table parameter that references the script reads
/// `reference` instead, e.g. `:"foo-2"`
export function renameScriptReferenceChanges(
    reports: ReadonlyMap<number, ScriptReferenceReport>,
    fileName: string,
    reference: string,
): Map<number, ScriptTextChange[]> {
    const out = new Map<number, ScriptTextChange[]>();
    for (const [scriptKey, report] of reports) {
        const changes = report.marks
            .filter(mark => mark.target === fileName && mark.parameter.length > 0)
            .map(mark => ({ from: mark.from, to: mark.to, insert: reference }));
        if (changes.length > 0) out.set(scriptKey, changes);
    }
    return out;
}

/// Apply changes to a text
export function applyScriptTextChanges(text: string, changes: readonly ScriptTextChange[]): string {
    let out = text;
    for (const change of [...changes].sort((l, r) => r.from - l.from)) {
        out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    }
    return out;
}
