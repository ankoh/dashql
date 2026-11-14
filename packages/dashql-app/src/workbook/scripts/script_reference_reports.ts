import { computeScriptReferenceReports, type ScriptReferenceReport } from '@ankoh/dashql-runtime/workbook/scripts/script_reference_check';
import { workbookAnalysisSignature, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';

function sameReport(l: ScriptReferenceReport, r: ScriptReferenceReport): boolean {
    return l.textVersion === r.textVersion
        && l.marks.length === r.marks.length
        && l.marks.every((m, i) => {
            const o = r.marks[i];
            return m.from === o.from && m.to === o.to && m.parameter === o.parameter && m.target === o.target
                && m.kind === o.kind && m.errors.length === o.errors.length && m.errors.every((e, j) => e === o.errors[j]);
        });
}

interface CachedCheck {
    signature: string;
    reports: Map<number, ScriptReferenceReport>;
}

/// The last check of every workbook, by workbook id
const CHECKS = new Map<string, CachedCheck>();

/// The checked script references of the scripts of a workbook, by script key. Checks again only when a name, a
/// connection or an analysis of a script changed, a report that did not change keeps its identity.
export function checkWorkbookScriptReferences(workbook: WorkbookScripts): Map<number, ScriptReferenceReport> {
    try {
        return checkWorkbookScriptReferencesOrThrow(workbook);
    } catch (e) {
        console.warn('cannot check the script references of the workbook', e);
        return NO_REPORTS;
    }
}

const NO_REPORTS = new Map<number, ScriptReferenceReport>();

function checkWorkbookScriptReferencesOrThrow(workbook: WorkbookScripts): Map<number, ScriptReferenceReport> {
    // Workbooks without the core, e.g. of tests, have no checks
    if (workbook.scriptOrder == null || workbook.scriptOrder.length === 0 || typeof workbook.instance?.checkScriptReferences !== 'function') {
        return NO_REPORTS;
    }
    const signature = workbookAnalysisSignature(workbook);
    const cached = CHECKS.get(workbook.workbookId);
    if (cached?.signature === signature) return cached.reports;
    const reports = computeScriptReferenceReports(workbook);
    // A script without a current analysis keeps its last report until it is analyzed again
    for (const [key, report] of cached?.reports ?? []) {
        const next = reports.get(key);
        if (next == null && workbook.scripts[key] != null) reports.set(key, report);
        else if (next != null && sameReport(next, report)) reports.set(key, report);
    }
    CHECKS.set(workbook.workbookId, { signature, reports });
    return reports;
}

/// Forget the check of a workbook
export function forgetWorkbookScriptReferences(workbookId: string): void {
    CHECKS.delete(workbookId);
}
