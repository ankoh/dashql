import type * as core from '../../core/index.js';

import { projectQueryProgress } from '../../platform/query/query_progress.js';
import type { QueryExecutionState } from '../../platform/query/query_execution_state.js';
import { share } from '../store/projection.js';
import type { ViewProjection } from '../store/runtime_store.js';

/// The projection of the query views of a runtime. The structured progress of a query crosses only when its revision
/// or the version of its structure moved, the view keeps the payloads it left out from the held view. The progress
/// of the latest update is built once per change of that update (`progress`): the structure of the plan is read once
/// per version, the same object while the update is unchanged.
export function createQueryProjection(dql: core.DashQL, runtime: core.Runtime): ViewProjection<'query', QueryExecutionState> {
    return {
        known: (_ids, views) => views.map(view => {
            const profile = view?.latestProgressUpdate?.profile;
            return profile == null ? null : { revision: profile.revision, structureVersion: profile.structureVersion };
        }),
        project: (queryId, prev, view) => {
            const held = prev?.latestProgressUpdate?.profile;
            const profile = view.latestProgressUpdate?.profile;
            if (held != null && profile != null) {
                if (profile.structure == null && held.structureVersion === profile.structureVersion) profile.structure = held.structure;
                if (profile.execution == null && held.revision === profile.revision) profile.execution = held.execution;
            }
            // The members that didn't change keep their objects, the latest progress update among them
            const next = share<core.QueryView>(prev as core.QueryView | null, view) as QueryExecutionState;
            const previous = prev?.latestProgressUpdate != null && prev.progress != null ? { view: prev.latestProgressUpdate, progress: prev.progress } : null;
            const progress = projectQueryProgress(dql, next.latestProgressUpdate, previous, { runtime, queryId });
            if (prev != null && progress === prev.progress && sameMembers(prev, next)) return prev;
            next.progress = progress;
            return next;
        },
    };
}

/// Do the members of a fresh view keep the objects of the held projection?
function sameMembers(prev: QueryExecutionState, next: QueryExecutionState): boolean {
    const held = prev as unknown as Record<string, unknown>;
    const fresh = next as unknown as Record<string, unknown>;
    const keys = Object.keys(fresh);
    return keys.length + 1 === Object.keys(held).length && keys.every(key => key in held && fresh[key] === held[key]);
}
