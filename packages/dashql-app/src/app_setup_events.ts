import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as appSession from '@ankoh/dashql-jsonschema/app_session.js';
import * as dashql from './core/index.js';

import { Logger } from './platform/logger/logger.js';
import { SETUP_SESSION, SetupEventVariant } from './platform/events/event.js';
import { importSessionFromZip } from './platform/storage/session_import.js';
import { restoreSingleSession, RestoredSession } from './platform/storage/app_state_loader.js';
import type { StorageBackend } from './platform/storage/storage_backend.js';
import { VariantKind } from './utils/variant.js';

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
    | VariantKind<typeof FINISHED_LINK_SETUP, { session: RestoredSession }>


/// Logic to configure the application with a setup event.
/// Called either through app links (url or os deep-link), or by opening a file
export async function configureAppWithSetupEvent(
    data: SetupEventVariant,
    logger: Logger,
    core: dashql.DashQL,
    backend: StorageBackend,
): Promise<AppLinkSetupResult | null> {
    switch (data.type) {
        case SETUP_SESSION: {
            logger.info("Starting app setup from session", { setup: "SETUP_SESSION" }, LOG_CTX);

            // Create blob from zip bytes
            const zipBlob = new Blob([data.value.buffer as ArrayBuffer], { type: 'application/zip' });

            // Import the session into storage. This allocates a fresh session UUID (the authoritative
            // identity) and persists the connection params + notebook to the session's folder.
            const sessionId = await importSessionFromZip(
                zipBlob,
                backend,
                () => crypto.randomUUID()
            );
            logger.info("Session imported", { sessionId }, LOG_CTX);

            // The initial app load already ran and populated the registries, so the just-written
            // session is not in them yet. Restore it from storage the same way the boot loader does,
            // so the caller can merge it into the live registries and open its connection setup
            // screen without a full reload.
            const session = await restoreSingleSession(core, backend, logger, sessionId);
            logger.info("Imported session restored", { sessionId }, LOG_CTX);

            return { type: FINISHED_LINK_SETUP, value: { session } };
        }
    }

    return null;
}
