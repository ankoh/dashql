import * as dashql from '../../../shared/core/index.js';
import { NotebookScripts } from './notebook_scripts.js';

export function findTableById(notebookScripts: NotebookScripts, table: dashql.ExternalObjectID.Value): dashql.buffers.analyzer.Table | null {
    const scriptKey = dashql.ExternalObjectID.getOrigin(table);
    const scriptData = notebookScripts.scripts[scriptKey];
    if (!scriptData) {
        console.log("SCRIPT DATA NULL");
        return null;
    }
    if (!scriptData.scriptAnalysis.buffers.analyzed) {
        console.log("SCRIPT NOT ANALYZED");
        return null;
    }
    const reader = scriptData.scriptAnalysis.buffers.analyzed.read();
    const tableId = dashql.ExternalObjectID.getObject(table);
    if (tableId >= reader.tablesLength()) {
        console.log("TABLE ID OUT OF BOUNDS");
        return null;
    }
    const tableProto = reader.tables(tableId);
    return tableProto;
}
