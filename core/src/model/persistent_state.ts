import { Platform } from  "../platform";
import { CoreState } from  "./state";
import { LogEntryVariant } from "./log";
import { Script } from "./script";

export interface PersistentCoreState {
    logEntries: LogEntryVariant[];
    script: Script;
};

export function persistState(state: CoreState, _platform: Platform): PersistentCoreState {
    return {
        logEntries: state.logEntries.toArray(),
        script: state.script,
    };
}

export function rehydrateState(persisted: PersistentCoreState, _platform: Platform): CoreState {
    let state = new CoreState();
    state.script = persisted.script;
    return state;
}
