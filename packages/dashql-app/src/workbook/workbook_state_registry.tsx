import * as React from 'react';

import { WorkbookState, DESTROY, WorkbookStateAction, reduceWorkbookState } from './workbook_state.js';
import { Dispatch } from '../utils/variant.js';
import { CONNECTOR_TYPES } from '../connection/connector_info.js';
import { useStorageWriter } from '../platform/storage_provider.js';

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
    /// The next workbook id for a connection type
    nextWorkbookIdByConnectionType: number[];
}

export type WorkbookStateWithoutId = Omit<WorkbookState, "workbookId">;
type SetWorkbookRegistryAction = React.SetStateAction<WorkbookRegistry>;
export type WorkbookAllocator = (workbook: WorkbookStateWithoutId) => WorkbookState;
export type ModifyWorkbook = (action: WorkbookStateAction) => void;
export type ModifyConnectionWorkbooks = (conn: number, action: WorkbookStateAction) => void;

const WORKBOOK_REGISTRY_CTX = React.createContext<[WorkbookRegistry, Dispatch<SetWorkbookRegistryAction>] | null>(null);
let NEXT_GLOBAL_WORKBOOK_ID: number = 1;

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const WorkbookStateRegistry: React.FC<Props> = (props: Props) => {
    const reg = React.useState<WorkbookRegistry>(() => ({
        workbookMap: new Map(),
        workbooksByConnection: new Map(),
        workbooksByConnectionType: CONNECTOR_TYPES.map(() => []),
        nextWorkbookIdByConnectionType: CONNECTOR_TYPES.map(() => 1),
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
    const [_reg, setReg] = React.useContext(WORKBOOK_REGISTRY_CTX)!;
    return React.useCallback((state: WorkbookStateWithoutId) => {
        const workbookId = NEXT_GLOBAL_WORKBOOK_ID++;
        const workbook: WorkbookState = {
            ...state,
            workbookId: workbookId
        };
        setReg((reg) => {
            const suffix = reg.nextWorkbookIdByConnectionType[workbook.connectorInfo.connectorType]++;
            if (workbook.workbookMetadata.fileName == "") {
                workbook.workbookMetadata.fileName = `${workbook.connectorInfo.names.fileShort}_${suffix}`;
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
        return workbook;
    }, [setReg]);
}

export function useWorkbookState(id: number | null): [WorkbookState | null, ModifyWorkbook] {
    const [registry, setRegistry] = React.useContext(WORKBOOK_REGISTRY_CTX)!;
    const storageWriter = useStorageWriter();

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
                const next = reduceWorkbookState(prev, action, storageWriter);
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

    const dispatch = React.useCallback<ModifyConnectionWorkbooks>((conn: number, action: WorkbookStateAction) => {
        setRegistry(
            (reg: WorkbookRegistry) => {
                const workbookIds = reg.workbooksByConnection.get(conn) ?? [];
                if (workbookIds.length == 0) {
                    return reg;
                }
                for (const workbookId of workbookIds) {
                    const prev = reg.workbookMap.get(workbookId);
                    const next = reduceWorkbookState(prev!, action, storage);
                    reg.workbookMap.set(workbookId, next);
                }
                return { ...reg };
            }
        );
    }, [setRegistry]);
    return dispatch;
}
