import * as dashql from '@ankoh/dashql-core';

import { Logger } from './platform/logger.js';
import { DB } from './storage/storage_setup.js';

/// Main logic to setup the application
export async function loadApp(logger: Logger, core: dashql.DashQL) {
    // Read storage
    const storedConnections = await DB.connections.toArray()
    const storedWorkbooks = await DB.workbooks.toArray();
}


