import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as app_notebook from '@ankoh/dashql-jsonschema/app_notebook.js';
import * as dashql from '../../shared/core/index.js';

import { Logger } from '../../shared/platform/logger/logger.js';
import { SETUP_NOTEBOOK, SetupEventVariant } from '../../shared/platform/events/event.js';
import { importNotebookFromZip } from '../notebook/persistence/notebook_import.js';
import { restoreSingleNotebook, type RestoredNotebook } from '../notebook/persistence/app_state_loader.js';
import type { StorageBackend } from '../notebook/persistence/storage_backend.js';
import { VariantKind } from '../../shared/utils/variant.js';
import type { ConnectionSignatureMap } from '../notebook/connections/connection_signature.js';

const LOG_CTX = 'app_setup';

export interface InteractiveAppSetupArgs {
    notebookId: string;
    connectionParams: connection.ConnectionParams;
    notebookProto: app_notebook.NotebookMetadata;
}

export const REQUIRES_INTERACTIVE_SETUP = Symbol("REQUIRES_INTERACTIVE_SETUP");
export const FINISHED_LINK_SETUP = Symbol("FINISH_SETUP");

export type AppLinkSetupResult =
    | VariantKind<typeof REQUIRES_INTERACTIVE_SETUP, InteractiveAppSetupArgs>
    | VariantKind<typeof FINISHED_LINK_SETUP, { restoredNotebook: RestoredNotebook }>

export async function importAndRestoreNotebook(
    zipBlob: Blob,
    logger: Logger,
    core: dashql.DashQL,
    backend: StorageBackend,
    connectionSignatures: ConnectionSignatureMap,
): Promise<RestoredNotebook> {
    const notebookId = await importNotebookFromZip(zipBlob, backend, () => crypto.randomUUID());
    try {
        return await restoreSingleNotebook(core, backend, logger, notebookId, connectionSignatures);
    } catch (error) {
        try {
            await backend.deleteNotebook(notebookId);
        } catch {
            // Preserve the restoration error when cleanup fails.
        }
        throw error;
    }
}


/// Logic to configure the application with a setup event.
/// Called either through app links (url or os deep-link), or by opening a file
export async function configureAppWithSetupEvent(
    data: SetupEventVariant,
    logger: Logger,
    core: dashql.DashQL,
    backend: StorageBackend,
    connectionSignatures: ConnectionSignatureMap,
): Promise<AppLinkSetupResult | null> {
    switch (data.type) {
        case SETUP_NOTEBOOK: {
            logger.info("Starting app setup from notebook", { setup: "SETUP_NOTEBOOK" }, LOG_CTX);

            // Create blob from zip bytes
            const zipBlob = new Blob([data.value.buffer as ArrayBuffer], { type: 'application/zip' });

            // Import the notebook into storage. This allocates a fresh notebook UUID (the authoritative
            // identity) and persists the connection params + notebook to the notebook's folder.
            // The initial app load already ran and populated the registries, so the just-written
            // notebook is not in them yet. Restore it from storage the same way the boot loader does,
            // so the caller can merge it into the live registries and open its connection setup
            // screen without a full reload.
            const restoredNotebook = await importAndRestoreNotebook(
                zipBlob,
                logger,
                core,
                backend,
                connectionSignatures,
            );
            logger.info("Imported notebook restored", { notebookId: restoredNotebook.notebookId }, LOG_CTX);

            return { type: FINISHED_LINK_SETUP, value: { restoredNotebook } };
        }
    }

    return null;
}
