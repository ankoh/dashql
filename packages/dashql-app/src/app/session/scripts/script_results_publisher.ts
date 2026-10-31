import * as core from '@ankoh/dashql-core';

import { scriptDisplayName } from './script_types.js';
import type { ScriptData, SessionScripts } from './session_scripts.js';

/// The results of the scripts of every session, by session id
const RESULTS = new Map<string, core.DashQLScriptResults>();

/// The results of the scripts of a session, which the table parameters of its scripts and drafts read
export function sessionScriptResults(session: SessionScripts): core.DashQLScriptResults | null {
    let results = RESULTS.get(session.sessionId);
    if (results == null) {
        // Sessions without the core, e.g. of tests, have no results
        if (typeof session.instance?.createScriptResults !== 'function') return null;
        results = session.instance.createScriptResults();
        RESULTS.set(session.sessionId, results);
    }
    return results;
}

/// Forget the results of a session
export function dropSessionScriptResults(sessionId: string): void {
    RESULTS.get(sessionId)?.destroy();
    RESULTS.delete(sessionId);
}

/// Publish the results of the scripts of a session after its scripts changed. The scripts whose analysis is outdated
/// by the results, e.g. those that read a script whose columns changed, are marked outdated and analyzed again.
export function publishScriptResults(prev: SessionScripts, next: SessionScripts): SessionScripts {
    if (prev.scripts === next.scripts && prev.scriptOrder === next.scriptOrder && prev.scriptRefs === next.scriptRefs) {
        return next;
    }
    try {
        const results = sessionScriptResults(next);
        if (results == null) return next;
        const scripts: ScriptData[] = [];
        for (const file of next.scriptOrder) {
            const script = next.scripts[next.scriptRefs[file]?.scriptId ?? -1];
            if (script != null) scripts.push(script);
        }
        const outdated = results.publish(scripts.map(script => ({ name: scriptDisplayName(script.fileName), session: script.scriptSession })));
        if (outdated.length === 0) return next;
        const marked = { ...next.scripts };
        for (const index of outdated) {
            const script = scripts[index];
            if (script != null && !script.analysisOutdated) marked[script.scriptKey] = { ...script, analysisOutdated: true };
        }
        return { ...next, scripts: marked };
    } catch (e) {
        console.warn('cannot publish the script results of the session', e);
        return next;
    }
}
