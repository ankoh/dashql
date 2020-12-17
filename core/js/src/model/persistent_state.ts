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
        state.program = await platform.coreWasm.parseProgram(persisted.program)
        state.plan = await platform.coreWasm.planProgram();
    }

    let cachedFiles: [string, CachedFileData][] = persisted.cachedFileData
        .filter(f => (platform.cache.cachesBlob(f.data)))
        .map(f => [f.cacheKey, f]);
    let cachedHTTPData: [string, CachedHTTPData][] = persisted.cachedHTTPData
        .filter(h => (!h.request.body || platform.cache.cachesBlob(h.request.body)) && (!h.response.body || platform.cache.cachesBlob(h.response.body)))
        .map(h => [h.cacheKey, h]);

    state.cachedFileData = Immutable.Map(cachedFiles);
    state.cachedHTTPData = Immutable.Map(cachedHTTPData);
    return state;
}
