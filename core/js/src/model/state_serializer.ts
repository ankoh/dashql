import * as Immutable from "immutable";
import { Platform } from  "../platform";
import { CoreState } from  "./state";
import { CachedFileData, CachedHTTPData } from "./cache";
import { LogEntry } from "./log";

export interface PersistedCoreState {
    logEntries: LogEntry[];
    program: string | null;
    cachedFileData: CachedFileData[];
    cachedHTTPData: CachedHTTPData[];
};

export async function persist(state: CoreState, _platform: Platform): Promise<PersistedCoreState> {
    return {
        logEntries: state.logEntries.toArray(),
        program: state.program?.text || null,
        cachedFileData: state.cachedFileData.valueSeq().toArray(),
        cachedHTTPData: state.cachedHTTPData.valueSeq().toArray(),
    };
}

export async function rehydrate(persisted: PersistedCoreState, platform: Platform): Promise<CoreState> {
    let state = new CoreState();
    if (persisted.program != null) {
        state.program = await platform.core_wasm.parseProgram(persisted.program)
        state.plan = await platform.core_wasm.planProgram();
    }

    let cachedFiles: [string, CachedFileData][] = persisted.cachedFileData
        .filter(f => (platform.blobs.isCached(f.data)))
        .map(f => [f.cache_key, f]);
    let cachedHTTPData: [string, CachedHTTPData][] = persisted.cachedHTTPData
        .filter(h => (!h.request.body || platform.blobs.isCached(h.request.body)) && (!h.response.body || platform.blobs.isCached(h.response.body)))
        .map(h => [h.cache_key, h]);

    state.cachedFileData = Immutable.Map(cachedFiles);
    state.cachedHTTPData = Immutable.Map(cachedHTTPData);
    return state;
}
