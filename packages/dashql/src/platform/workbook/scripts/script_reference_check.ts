import * as core from '../../../core/index.js';


const NONE = 0xFFFFFFFF;

/// What a script reference reads
export enum ScriptReferenceKind {
    /// The query of the referenced script is inlined into the statement, both run on one connection
    Inline = 'inline',
    /// The statement scans the result of a script of another connection, materialized as Parquet file
    Scan = 'scan',
    /// The reference has errors
    Invalid = 'invalid',
    /// The statement scans an attachment of the workbook
    Attachment = 'attachment',
}

/// A checked table parameter of a script, `:foo`
export interface ScriptReferenceMark {
    /// The begin of the parameter, at the prefix, in UTF-16 code units
    from: number;
    /// The end of the parameter
    to: number;
    /// The parameter name
    parameter: string;
    /// The file name of the referenced script, null if the name finds none
    target: string | null;
    /// The file name of the referenced attachment, null if the name finds none
    attachment: string | null;
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

function sameReport(l: ScriptReferenceReport, r: ScriptReferenceReport): boolean {
    return l.textVersion === r.textVersion
        && l.marks.length === r.marks.length
        && l.marks.every((m, i) => {
            const o = r.marks[i];
            return m.from === o.from && m.to === o.to && m.parameter === o.parameter && m.target === o.target
                && m.attachment === o.attachment && m.kind === o.kind && m.errors.length === o.errors.length
                && m.errors.every((e, j) => e === o.errors[j]);
        });
}

/// The checked script references of the scripts of a workbook by script key, from the check of the runtime. The
/// scripts are in feed order with their file names, the attachments by their file names. A script without a current
/// analysis keeps its previous report until it is analyzed again, a report that did not change keeps its identity.
export function readScriptReferenceReports(
    check: core.buffers.execution.ScriptReferenceCheckT,
    scriptKeys: readonly number[],
    files: readonly (string | null)[],
    attachments: readonly string[],
    prev: ReadonlyMap<number, ScriptReferenceReport> | null,
): Map<number, ScriptReferenceReport> {
    const reports = new Map<number, ScriptReferenceReport>();
    check.scripts.forEach((checked, index) => {
        const key = scriptKeys[index];
        if (key == null) return;
        const previous = prev?.get(key);
        if (!checked.checked) {
            if (previous != null) reports.set(key, previous);
            return;
        }
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
                target: reference.script !== NONE ? files[reference.script] ?? null : null,
                attachment: reference.attachment !== NONE ? attachments[reference.attachment] ?? null : null,
                kind,
                errors: reference.errors.map(String),
            };
        });
        const report = { textVersion: checked.textVersion, marks };
        reports.set(key, previous != null && sameReport(previous, report) ? previous : report);
    });
    return reports;
}

/// A change of the text of a script, in UTF-16 code units of the text before the change
export interface ScriptTextChange {
    from: number;
    to: number;
    insert: string;
}

/// Apply changes to a text
export function applyScriptTextChanges(text: string, changes: readonly ScriptTextChange[]): string {
    let out = text;
    for (const change of [...changes].sort((l, r) => r.from - l.from)) {
        out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    }
    return out;
}
