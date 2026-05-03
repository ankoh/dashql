import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as appSession from '@ankoh/dashql-jsonschema/app_session.js';
import * as dashql from './core/index.js';

import { ConnectionAllocator, ConnectionRegistry } from './connection/connection_registry.js';
import { LoggerLike } from './platform/logger/logger.js';
import { SETUP_SESSION, SetupEventVariant } from './platform/events/event.js';
import { importSessionFromZip } from './platform/storage/session_import.js';
import type { StorageBackend } from './platform/storage/storage_backend.js';
import { VariantKind } from './utils/variant.js';
import { NotebookSetup } from './notebook/notebook_setup.js';

const LOG_CTX = 'app_setup';

export interface InteractiveAppSetupArgs {
    sessionId: string;
    connectionParams: connection.ConnectionParams;
    notebookProto: appSession.NotebookMetadata;
}

export const REQUIRES_INTERACTIVE_SETUP = Symbol("REQUIRES_INTERACTIVE_SETUP");
export const FINISHED_LINK_SETUP = Symbol("FINISH_SETUP");

export type AppLinkSetupResult =
    | VariantKind<typeof REQUIRES_INTERACTIVE_SETUP, InteractiveAppSetupArgs>
    | VariantKind<typeof FINISHED_LINK_SETUP, { sessionId: string }>


/// Logic to configure the application with a setup event.
/// Called either through app links (url or os deep-link), or by opening a file
export async function configureAppWithSetupEvent(
    data: SetupEventVariant,
    logger: LoggerLike,
    core: dashql.DashQL,
    allocateConnection: ConnectionAllocator,
    setupNotebook: NotebookSetup,
    connections: ConnectionRegistry,
    backend: StorageBackend,
    setupDone: () => void
): Promise<AppLinkSetupResult | null> {
    let setupName = "?";

    switch (data.type) {
        case SETUP_SESSION: {
            setupName = "SETUP_SESSION";
            logger.info("Starting app setup from session", { setup: setupName });

            // Create blob from zip bytes
            const zipBlob = new Blob([data.value.buffer as ArrayBuffer], { type: 'application/zip' });

            // Import session from zip
            // This will handle creating the connection and notebooks
            const sessionPath = await importSessionFromZip(
                zipBlob,
                backend,
                () => `imported-${Date.now()}`  // Generate unique session path
            );

            logger.info("Session imported", { sessionPath });

            // TODO: Return appropriate result with notebook and connection IDs
            // For now, return null to indicate setup is complete
            setupDone();
            return null;
        }
    }

    return null;
}
