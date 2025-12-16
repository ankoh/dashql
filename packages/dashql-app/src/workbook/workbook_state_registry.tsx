import * as React from 'react';

import { WorkbookState, DESTROY, WorkbookStateAction, reduceWorkbookState } from './workbook_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES, ConnectorType } from '../connection/connector_info.js';
import { useStorageWriter } from '../storage/storage_provider.js';
import { useLogger } from '../platform/logger_provider.js';
import { DEBOUNCE_DURATION_WORKBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_WORKBOOK_WRITE, groupScriptWrites, groupWorkbookWrites, WRITE_WORKBOOK_SCRIPT, WRITE_WORKBOOK_STATE } from '../storage/storage_writer.js';

/// The workbook registry.
///
/// Note that we're deliberately not using immutable maps for workbooks and the connection index.
/// We're never "observing" these maps directly and thus can live with the simple variants.
/// Shallow-compare the entire registry object instead when reacting to workbook list changes.
export interface WorkbookRegistry {
    /// The workbook map
    workbookMap: Map<number, WorkbookState>;
    /// The index to find workbooks associated with a connection id
    workbooksByConnection: Map<number, number[]>;
    /// The index to find workbooks associated with a connection type
    workbooksByConnectionType: number[][];
}

export type WorkbookStateWithoutId = Omit<WorkbookState, "workbookId">;
export type SetWorkbookRegistryAction = React.SetStateAction<WorkbookRegistry>;
export type WorkbookAllocator = (workbook: WorkbookStateWithoutId) => WorkbookState;
export type ModifyWorkbook = (action: WorkbookStateAction) => void;
export type ModifyConnectionWorkbooks = (conn: number, action: WorkbookStateAction) => void;

const WORKBOOK_REGISTRY_CTX = React.createContext<[WorkbookRegistry, Dispatch<SetWorkbookRegistryAction>] | null>(null);
let NEXT_WORKBOOK_ID: number = 1;

export function nextWorbookIdMustBeLargerThan(wid: number) {
    NEXT_WORKBOOK_ID = Math.max(NEXT_WORKBOOK_ID, wid + 1);
}

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const WorkbookStateRegistry: React.FC<Props> = (props: Props) => {
    const reg = React.useState<WorkbookRegistry>(() => ({
        workbookMap: new Map(),
        workbooksByConnection: new Map(),
        workbooksByConnectionType: CONNECTOR_TYPES.map(() => []),
    }));
    return (
        <WORKBOOK_REGISTRY_CTX.Provider value={reg}>
            {props.children}
        </WORKBOOK_REGISTRY_CTX.Provider>
    );
};

export function useWorkbookRegistry(): [WorkbookRegistry, Dispatch<SetWorkbookRegistryAction>] {
    return React.useContext(WORKBOOK_REGISTRY_CTX)!;
}

export function useWorkbookStateAllocator(): WorkbookAllocator {
    const storage = useStorageWriter();
    const [_reg, setReg] = React.useContext(WORKBOOK_REGISTRY_CTX)!;
    return React.useCallback((state: WorkbookStateWithoutId) => {
        const workbookId = NEXT_WORKBOOK_ID++;
        const workbook: WorkbookState = {
            ...state,
            workbookId: workbookId
        };
        // Modify the registry
        setReg((reg) => {
            if (workbook.workbookMetadata.originalFileName == "") {
                workbook.workbookMetadata.originalFileName = `${workbook.connectorInfo.names.fileShort}_${workbook.connectionId}`;
            }
            const sameConnection = reg.workbooksByConnection.get(state.connectionId);
            if (sameConnection) {
                sameConnection.push(workbookId);
            } else {
                reg.workbooksByConnection.set(state.connectionId, [workbookId]);
            }
            reg.workbooksByConnectionType[state.connectorInfo.connectorType].push(workbookId);
            reg.workbookMap.set(workbookId, workbook);
            return { ...reg };
        });
        // Schedule workbook and scripts
        if (workbook.connectorInfo.connectorType != ConnectorType.DEMO) {
            for (const v of Object.values(workbook.scripts)) {
                if (v.script == null) {
                    continue;
                }
                storage.write(groupScriptWrites(workbookId, v.scriptKey), {
                    type: WRITE_WORKBOOK_SCRIPT,
                    value: [workbookId, v.scriptKey, v.script]
                }, DEBOUNCE_DURATION_WORKBOOK_SCRIPT_WRITE);
            }
            storage.write(groupWorkbookWrites(workbookId), {
                type: WRITE_WORKBOOK_STATE,
                value: [workbookId, workbook]
            }, DEBOUNCE_DURATION_WORKBOOK_WRITE);

        }
        return workbook;
    }, [setReg]);
}

export function useWorkbookState(id: number | null): [WorkbookState | null, ModifyWorkbook] {
    const [registry, setRegistry] = React.useContext(WORKBOOK_REGISTRY_CTX)!;
    const storageWriter = useStorageWriter();
    const logger = useLogger();

    /// Wrapper to modify an individual workbook
    const dispatch = React.useCallback((action: WorkbookStateAction) => {
        setRegistry(
            (reg: WorkbookRegistry) => {
                // No id provided? Then do nothing.
                if (!id) {
                    return reg;
                }
                // Find the previous workbook state
                const prev = reg.workbookMap.get(id);
                // Ignore if the workbook does not exist
                if (!prev) {
                    console.warn(`no workbook registered with id ${id}`);
                    return reg;
                }
                // Reduce the workbook action
                const next = reduceWorkbookState(prev, action, storageWriter, logger);
                // Should we delete the entry?
                if (action.type == DESTROY) {
                    reg.workbookMap.delete(id)
                    reg.workbooksByConnectionType[prev.connectorInfo.connectorType] = reg.workbooksByConnectionType[prev.connectorInfo.connectorType].filter(c => c != prev.workbookId);
                    let byConn = reg.workbooksByConnection.get(prev.connectionId) ?? [];
                    byConn = byConn.filter(c => c != prev.workbookId);
                    if (byConn.length == 0) {
                        reg.workbooksByConnection.delete(prev.connectionId);
                    } else {
                        reg.workbooksByConnection.set(prev.connectionId, byConn);
                    }
                    return { ...reg }
                } else {
                    reg.workbookMap.set(id, next);
                    return { ...reg };
                }
            }
        );
    }, [id, setRegistry]);

    return [id == null ? null : registry.workbookMap.get(id) ?? null, dispatch];
};

export function useConnectionWorkbookDispatch(): ModifyConnectionWorkbooks {
    const [_registry, setRegistry] = React.useContext(WORKBOOK_REGISTRY_CTX)!;
    const storage = useStorageWriter();
    const logger = useLogger();

    const dispatch = React.useCallback<ModifyConnectionWorkbooks>((conn: number, action: WorkbookStateAction) => {
        setRegistry(
            (reg: WorkbookRegistry) => {
                const workbookIds = reg.workbooksByConnection.get(conn) ?? [];
                if (workbookIds.length == 0) {
                    return reg;
                }
                for (const workbookId of workbookIds) {
                    const prev = reg.workbookMap.get(workbookId);
                    const next = reduceWorkbookState(prev!, action, storage, logger);
                    reg.workbookMap.set(workbookId, next);
                }
                return { ...reg };
            }
        );
    }, [setRegistry]);
    return dispatch;
}
