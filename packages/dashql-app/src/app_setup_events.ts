import * as pb from '@ankoh/dashql-protobuf';
import * as dashql from '@ankoh/dashql-core';

import { ConnectionAllocator, ConnectionRegistry } from './connection/connection_registry.js';
import { ConnectorType, getConnectorInfoForParams } from './connection/connector_info.js';
import { LoggableException, Logger } from './platform/logger.js';
import { SETUP_FILE, SETUP_NOTEBOOK, SetupEventVariant } from './platform/event.js';
import { VariantKind } from './utils/variant.js';
import { NotebookSetup } from './notebook/notebook_setup.js';
import { createConnectionStateForType } from './connection/connection_state.js';

const LOG_CTX = 'app_setup';

export interface InteractiveAppSetupArgs {
    connectionId: number;
    connectionParams: pb.dashql.connection.ConnectionParams;
    notebookId: number;
    notebookProto: pb.dashql.notebook.Notebook;
}

export const REQUIRES_INTERACTIVE_SETUP = Symbol("REQUIRES_INTERACTIVE_SETUP");
export const FINISHED_LINK_SETUP = Symbol("FINISH_SETUP");

export type AppLinkSetupResult =
    | VariantKind<typeof REQUIRES_INTERACTIVE_SETUP, InteractiveAppSetupArgs>
    | VariantKind<typeof FINISHED_LINK_SETUP, { notebookId: number; connectionId: number; }>


/// Logic to configure the application with a setup event.
/// Called either through app links (url or os deep-link), or by opening a file
export async function configureAppWithSetupEvent(data: SetupEventVariant, logger: Logger, core: dashql.DashQL, allocateConnection: ConnectionAllocator, setupNotebook: NotebookSetup, connections: ConnectionRegistry, setupDone: () => void): Promise<AppLinkSetupResult | null> {
    // Resolve notebook
    let catalogs: pb.dashql.catalog.Catalog[] = [];
    let notebooks: pb.dashql.notebook.Notebook[] = [];
    let setupName = "?";
    switch (data.type) {
        case SETUP_NOTEBOOK:
            setupName = "SETUP_NOTEBOOK";
            notebooks.push(data.value);
            break;
        case SETUP_FILE:
            setupName = "SETUP_FILE";
            catalogs = data.value.catalogs;
            notebooks = data.value.notebooks;
            break;
    }
    logger.info("starting app setup", {
        setup: setupName,
        catalogs: catalogs.length.toString(),
        notebooks: notebooks.length.toString()
    });

    // Setup connection
    for (const catalogProto of catalogs) {
        // Get the connector info for the notebook setup protobuf
        const connectorInfo = catalogProto.connectionParams ? getConnectorInfoForParams(catalogProto.connectionParams) : null;
        if (connectorInfo == null) {
            throw new LoggableException("failed to resolve the connector info from the parameters", {});
        }

        // XXX
    }

    // Setup notebooks
    for (const notebookProto of notebooks) {
        // Get the connector info for the notebook setup protobuf
        const connectorInfo = notebookProto.connectionParams ? getConnectorInfoForParams(notebookProto.connectionParams) : null;
        if (connectorInfo == null) {
            throw new LoggableException("failed to resolve the connector info from the parameters", {});
        }
        switch (notebookProto.connectionParams?.connection.case) {
            case "hyper": {
                const connWithoutId = createConnectionStateForType(core, ConnectorType.HYPER, connections.connectionsBySignature);
                const conn = allocateConnection(connWithoutId);
                const notebook = setupNotebook(conn);
                return {
                    type: REQUIRES_INTERACTIVE_SETUP,
                    value: {
                        connectionId: conn.connectionId,
                        connectionParams: notebookProto.connectionParams,
                        notebookId: notebook.notebookId,
                        notebookProto,
                    }
                };
            }
            case "salesforce": {
                const connWithoutId = createConnectionStateForType(core, ConnectorType.SALESFORCE_DATA_CLOUD, connections.connectionsBySignature);
                const conn = allocateConnection(connWithoutId);
                const notebook = setupNotebook(conn);
                return {
                    type: REQUIRES_INTERACTIVE_SETUP,
                    value: {
                        connectionId: conn.connectionId,
                        connectionParams: notebookProto.connectionParams,
                        notebookId: notebook.notebookId,
                        notebookProto,
                    }
                };
            }
            case "trino": {
                const connWithoutId = createConnectionStateForType(core, ConnectorType.TRINO, connections.connectionsBySignature);
                const conn = allocateConnection(connWithoutId);
                const notebook = setupNotebook(conn);
                return {
                    type: REQUIRES_INTERACTIVE_SETUP,
                    value: {
                        connectionId: conn.connectionId,
                        connectionParams: notebookProto.connectionParams,
                        notebookId: notebook.notebookId,
                        notebookProto,
                    }
                };
            }
            case "dataless": {
                if (connections.connectionsByType![ConnectorType.DATALESS].length == 0) {
                    throw new LoggableException("missing default dataless connection", {});
                }
                const connectionId = connections.connectionsByType![ConnectorType.DATALESS].values().next().value!;
                const conn = connections.connectionMap.get(connectionId)!;
                const notebook = setupNotebook(conn);
                return {
                    type: FINISHED_LINK_SETUP,
                    value: {
                        notebookId: notebook.notebookId,
                        connectionId: notebook.connectionId,
                    }
                };
            }
            case "demo": {
                if (connections.connectionsByType![ConnectorType.DEMO].length == 0) {
                    throw new LoggableException("missing default demo connection", {});
                }
                const connectionId = connections.connectionsByType![ConnectorType.DEMO].values().next().value!;
                const conn = connections.connectionMap.get(connectionId)!;
                const notebook = setupNotebook(conn);
                return {
                    type: FINISHED_LINK_SETUP,
                    value: {
                        notebookId: notebook.notebookId,
                        connectionId: notebook.connectionId,
                    }
                };
            }
        }
    }
    return null;
}
