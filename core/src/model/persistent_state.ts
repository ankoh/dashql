import { Platform } from  "../platform";
import { CoreState } from  "./state";
import { LogEntryVariant } from "./log";

export interface PersistentCoreState {
    logEntries: LogEntryVariant[];
    programText: string;
};

export function persistState(state: CoreState, _platform: Platform): PersistentCoreState {
    return {
        logEntries: state.logEntries.toArray(),
        programText: state.programText,
    };
}

export function rehydrateState(persisted: PersistentCoreState, _platform: Platform): CoreState {
    let state = new CoreState();
    state.programText = persisted.programText;
    return state;
}
