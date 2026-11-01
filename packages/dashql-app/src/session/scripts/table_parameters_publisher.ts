import * as core from '@ankoh/dashql-core';

import { scriptDisplayName } from './script_types.js';
import { orderedSessionScripts, type SessionScripts } from './session_scripts.js';

/// The table parameters of every session, by session id
const REGISTRIES = new Map<string, core.DashQLTableParameters>();

/// The table parameters of a session, which the scripts and drafts of the session read
export function sessionTableParameters(session: SessionScripts): core.DashQLTableParameters | null {
    let registry = REGISTRIES.get(session.sessionId);
    if (registry == null) {
        // Sessions without the core, e.g. of tests, have no table parameters
        if (typeof session.instance?.createTableParameters !== 'function') return null;
        registry = session.instance.createTableParameters();
        REGISTRIES.set(session.sessionId, registry);
    }
    return registry;
}

/// Forget the table parameters of a session
export function dropSessionTableParameters(sessionId: string): void {
    REGISTRIES.get(sessionId)?.destroy();
    REGISTRIES.delete(sessionId);
}

/// Publish the table parameters of a session after its scripts changed. The scripts whose analysis is outdated by
/// them, e.g. those that read a script whose columns changed, are marked outdated and analyzed again.
export function publishTableParameters(prev: SessionScripts, next: SessionScripts): SessionScripts {
    if (prev.scripts === next.scripts && prev.scriptOrder === next.scriptOrder && prev.scriptRefs === next.scriptRefs) {
        return next;
    }
    try {
        const registry = sessionTableParameters(next);
        if (registry == null) return next;
        const scripts = orderedSessionScripts(next);
        const outdated = registry.publish(scripts.map(script => ({ name: scriptDisplayName(script.fileName), session: script.scriptSession })));
        if (outdated.length === 0) return next;
        const marked = { ...next.scripts };
        for (const index of outdated) {
            const script = scripts[index];
            if (script != null && !script.analysisOutdated) marked[script.scriptKey] = { ...script, analysisOutdated: true };
        }
        return { ...next, scripts: marked };
    } catch (e) {
        console.warn('cannot publish the table parameters of the session', e);
        return next;
    }
}
