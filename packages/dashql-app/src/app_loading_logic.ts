import * as dashql from '@ankoh/dashql-core';

import { Logger } from './platform/logger.js';
import { DB } from './storage/storage_setup.js';
import { StorageReader } from './storage/storage_reader.js';
import { AppLoadingProgressConsumer } from 'app_loading_progress.js';

/// Main logic to setup the application
export async function loadApp(logger: Logger, core: dashql.DashQL, storage: StorageReader, consumer: AppLoadingProgressConsumer) {
    /// First restore the previous app state
    const restoredAppState = await storage.restoreAppState(core, consumer);
}


