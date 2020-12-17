import * as Immutable from "immutable";
import { Platform } from  "../platform";
import { CoreState } from  "./state";
import { CachedFileData, CachedHTTPData } from "./cache";
import { LogEntry } from "./log";

export interface PersistentCoreState {
    logEntries: LogEntry[];
    programText: string;
    cachedFileData: CachedFileData[];
    cachedHTTPData: CachedHTTPData[];
};

export function persistState(state: CoreState, _platform: Platform): PersistentCoreState {
    return {
        logEntries: state.logEntries.toArray(),
        programText: state.programText,
        cachedFileData: state.cachedFileData.valueSeq().toArray(),
        cachedHTTPData: state.cachedHTTPData.valueSeq().toArray(),
    };
}

export function rehydrateState(persisted: PersistentCoreState, platform: Platform): CoreState {
    let state = new CoreState();
    state.programText = persisted.programText;
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
