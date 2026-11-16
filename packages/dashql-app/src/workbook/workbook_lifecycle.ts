import * as React from 'react';

import { CONNECTOR_INFOS, type ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import type { InvalidWorkbook, WorkbookValidationError } from '@ankoh/dashql-runtime/storage/workbook_validation';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';

import { useOptionalRuntime, useWorkbookList } from '../runtime/runtime_hooks.js';
import { useScriptSelection } from './scripts/script_selection.js';

// Creating and deleting workbooks in the app: the commands of the runtime with what the app adds, the file name of a
// new workbook after its connector and the selection that forgets a deleted workbook. The hooks resolve the runtime
// when their function is called, a test may render a component without the runtime as long as it doesn't call them.

/// The runtime, resolved when a function of a hook is called
function useLazyRuntime() {
    const runtime = useOptionalRuntime();
    return React.useCallback(() => {
        if (runtime == null) throw new Error('the workbooks need a RuntimeProvider');
        return runtime;
    }, [runtime]);
}

/// The workbooks that were refused a load
export interface InvalidWorkbooks {
    /// The invalid workbooks (workbookId -> reason)
    invalidWorkbooks: ReadonlyMap<string, InvalidWorkbook>;
    /// Delete the files of an invalid workbook and drop it from the list
    deleteInvalidWorkbook: (workbookId: string) => Promise<void>;
}

const NO_INVALID_WORKBOOKS: ReadonlyMap<string, InvalidWorkbook> = new Map();

/// The workbooks that were refused a load, from the list of the workbooks
export function useInvalidWorkbooks(): InvalidWorkbooks {
    const runtime = useLazyRuntime();
    const list = useWorkbookList();
    const invalid = list?.invalidWorkbooks;
    const invalidWorkbooks = React.useMemo(() => {
        if (invalid == null || invalid.length === 0) return NO_INVALID_WORKBOOKS;
        return new Map(invalid.map(workbook => [workbook.workbookId, {
            workbookId: workbook.workbookId,
            title: workbook.title,
            connectorType: workbook.connectorType as ConnectorType | null,
            error: workbook.error as WorkbookValidationError,
        }]));
    }, [invalid]);
    const deleteInvalidWorkbook = React.useCallback((workbookId: string) => runtime().deleteInvalidWorkbook(workbookId), [runtime]);
    return React.useMemo(() => ({ invalidWorkbooks, deleteInvalidWorkbook }), [invalidWorkbooks, deleteInvalidWorkbook]);
}

/// Create a workbook without scripts on a connection and write its first manifest, returns its view. The file name of
/// the workbook follows its connector.
export function useCreateWorkbook(): (connectionId: string, name: string, ephemeral: boolean) => WorkbookScripts {
    const runtime = useLazyRuntime();
    return React.useCallback((connectionId: string, name: string, ephemeral: boolean) => {
        const rt = runtime();
        const connectorType = rt.connection(connectionId)?.connectorType as ConnectorType | undefined;
        const originalFileName = connectorType == null ? undefined : CONNECTOR_INFOS[connectorType]?.names.fileShort;
        return rt.createWorkbook(connectionId, name, ephemeral, originalFileName);
    }, [runtime]);
}

/// Drop a workbook from the runtime, its scripts leave the catalogs of their connections. The selection of the app
/// forgets it.
export function useDeleteWorkbook(): (workbookId: string) => void {
    const runtime = useLazyRuntime();
    const selection = useScriptSelection();
    return React.useCallback((workbookId: string) => {
        runtime().deleteWorkbook(workbookId);
        selection.forget(workbookId);
    }, [runtime, selection]);
}
