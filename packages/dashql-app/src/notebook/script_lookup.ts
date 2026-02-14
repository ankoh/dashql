import * as dashql from '@ankoh/dashql-core';
import { NotebookState } from './notebook_state.js';

export function findTableById(notebook: NotebookState, table: dashql.ExternalObjectID.Value): dashql.buffers.analyzer.Table | null {
    const scriptKey = dashql.ExternalObjectID.getOrigin(table);
    const scriptData = notebook.scripts[scriptKey];
    if (!scriptData) {
        console.log("SCRIPT DATA NULL");
        return null;
    }
    if (!scriptData.processed.analyzed) {
        console.log("SCRIPT NOT ANALYZED");
        return null;
    }
    const reader = scriptData.processed.analyzed.read();
    const tableId = dashql.ExternalObjectID.getObject(table);
    if (tableId >= reader.tablesLength()) {
        console.log("TABLE ID OUT OF BOUNDS");
        return null;
    }
    const tableProto = reader.tables(tableId);
    return tableProto;
}
