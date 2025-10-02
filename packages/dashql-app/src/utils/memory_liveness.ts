import * as dashql from '@ankoh/dashql-core';

import { ConnectionRegistry } from '../connection/connection_registry.js';
import { WorkbookRegistry } from '../workbook/workbook_state_registry.js';

export function checkMemoryLiveness(core: dashql.DashQL, connections: ConnectionRegistry, workbooks: WorkbookRegistry) {
    const epoch = core.acquireLivenessEpoch();

    for (const v of connections.connectionMap.values()) {
        v.catalog.ptr?.markAliveInEpoch(epoch);
        v.catalog.snapshot?.ptr?.markAliveInEpoch(epoch);
    }
    for (const v of workbooks.workbookMap.values()) {
        v.scriptRegistry?.ptr?.markAliveInEpoch(epoch);
        v.userFocus?.registryColumnInfo?.markAliveInEpoch(epoch);

        for (const s of Object.values(v.scripts)) {
            s.script?.ptr.markAliveInEpoch(epoch);
            s.processed?.parsed?.markAliveInEpoch(epoch);
            s.processed?.scanned?.markAliveInEpoch(epoch);
            s.processed?.analyzed?.markAliveInEpoch(epoch);
            s.cursor?.markAliveInEpoch(epoch);
            s.completion?.buffer.markAliveInEpoch(epoch);
            for (let stats of s.statistics.values()) {
                stats.markAliveInEpoch(epoch);
            }
        }
    }

    const liveness = core.checkMemoryLiveness(epoch);
    console.log(liveness);
}
