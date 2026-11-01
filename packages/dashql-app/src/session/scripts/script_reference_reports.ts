import { computeScriptReferenceReports, type ScriptReferenceReport } from './script_reference_check.js';
import type { SessionScripts } from './session_scripts.js';

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

/// The last check of every session, by session id
const CHECKS = new Map<string, CachedCheck>();

/// What the check of a session depends on: the names, connections and analyses of its scripts
function checkSignature(session: SessionScripts): string {
    return session.scriptOrder.map(file => session.scripts[session.scriptRefs[file]?.scriptId ?? -1]).filter(script => script != null).map(script => [
        script.scriptKey,
        script.fileName,
        script.connection.connectionId,
        script.connection.local ? 'L' : 'R',
        script.scriptSession.getTextVersion(),
        // The analyzed text, not the cursor: the check reads the text and its analysis only
        script.editorUpdate?.textVersion ?? '',
        script.editorUpdate?.analysisAvailable ? 'A' : '',
    ].join('\u0001')).join('\u0002');
}

/// The checked script references of the scripts of a session, by script key. Checks again only when a name, a
/// connection or an analysis of a script changed, a report that did not change keeps its identity.
export function checkSessionScriptReferences(session: SessionScripts): Map<number, ScriptReferenceReport> {
    try {
        return checkSessionScriptReferencesOrThrow(session);
    } catch (e) {
        console.warn('cannot check the script references of the session', e);
        return NO_REPORTS;
    }
}

const NO_REPORTS = new Map<number, ScriptReferenceReport>();

function checkSessionScriptReferencesOrThrow(session: SessionScripts): Map<number, ScriptReferenceReport> {
    // Sessions without the core, e.g. of tests, have no checks
    if (session.scriptOrder == null || session.scriptOrder.length === 0 || typeof session.instance?.checkScriptReferences !== 'function') {
        return NO_REPORTS;
    }
    const signature = checkSignature(session);
    const cached = CHECKS.get(session.sessionId);
    if (cached?.signature === signature) return cached.reports;
    const reports = computeScriptReferenceReports(session);
    // A script without a current analysis keeps its last report until it is analyzed again
    for (const [key, report] of cached?.reports ?? []) {
        const next = reports.get(key);
        if (next == null && session.scripts[key] != null) reports.set(key, report);
        else if (next != null && sameReport(next, report)) reports.set(key, report);
    }
    CHECKS.set(session.sessionId, { signature, reports });
    return reports;
}

/// Forget the check of a session
export function forgetSessionScriptReferences(sessionId: string): void {
    CHECKS.delete(sessionId);
}
