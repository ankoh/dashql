import * as core from '@ankoh/dashql-core';

import { CONNECTOR_INFOS, ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { ANALYZE_OUTDATED_SCRIPT, createWorkbookScripts, reduceWorkbookScripts, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { createEmptyMetadata } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import { TestLogger } from '@ankoh/dashql-runtime/testing/test_logger';

const STORAGE = { write: async () => true };
const LOGGER = new TestLogger();

/// Analyze the outdated scripts of a workbook until none is outdated: a script that publishes its declarations
/// outdates the scripts that read them
function analyzed(workbook: WorkbookScripts): WorkbookScripts {
    for (let round = 0; round < 4; ++round) {
        const outdated = workbook.scriptOrder.map(name => workbook.scriptRefs[name].scriptId)
            .filter(key => workbook.native!.workbook.isAnalysisOutdated(key));
        if (outdated.length === 0) break;
        for (const key of outdated) {
            workbook = reduceWorkbookScripts(workbook, { type: ANALYZE_OUTDATED_SCRIPT, value: key }, STORAGE, LOGGER);
        }
    }
    return workbook;
}

/// A workbook of analyzed scripts on one connection, the declarations of every script are in the catalog
export function analyzedTestWorkbook(dql: core.DashQL, entries: Array<[string, string]>): WorkbookScripts {
    const connection = { connectionId: 'main', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog() };
    return analyzed(createWorkbookScripts({
        instance: dql,
        workbookId: crypto.randomUUID(),
        name: 'Dataflow',
        pendingConnection: null,
        workbookMetadata: createEmptyMetadata(),
        scripts: entries.map(([name, sql]) => ({ name, sql, connection })),
    }));
}

/// A workbook with one more script, analyzed with the catalog of the other scripts
export function withTestScript(workbook: WorkbookScripts, fileName: string, text: string): WorkbookScripts {
    const native = workbook.native!;
    const connection = Object.values(workbook.scripts)[0].connection;
    native.workbook.addStoredScript(fileName, text, native.connection(connection));
    return analyzed(native.project(workbook));
}
