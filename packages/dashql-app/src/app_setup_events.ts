import * as pb from '@ankoh/dashql-protobuf';
import * as dashql from '@ankoh/dashql-core';

import { ConnectionAllocator, ConnectionRegistry } from './connection/connection_registry.js';
import { ConnectorType, getConnectorInfoForParams } from './connection/connector_info.js';
import { LoggableException, Logger } from './platform/logger.js';
import { SETUP_FILE, SETUP_WORKBOOK, SetupEventVariant } from './platform/event.js';
import { VariantKind } from './utils/variant.js';
import { WorkbookSetup } from './workbook/workbook_setup.js';
import { createConnectionStateForType } from './connection/connection_state.js';

const LOG_CTX = 'app_setup';

export interface InteractiveAppSetupArgs {
    connectionId: number;
    connectionParams: pb.dashql.connection.ConnectionParams;
    workbookId: number;
    workbookProto: pb.dashql.workbook.Workbook;
}

export const REQUIRES_INTERACTIVE_SETUP = Symbol("REQUIRES_INTERACTIVE_SETUP");
export const FINISHED_LINK_SETUP = Symbol("FINISH_SETUP");

export type AppLinkSetupResult =
    | VariantKind<typeof REQUIRES_INTERACTIVE_SETUP, InteractiveAppSetupArgs>
    | VariantKind<typeof FINISHED_LINK_SETUP, { workbookId: number; connectionId: number; }>


/// Logic to configure the application with a setup event.
/// Called either through app links (url or os deep-link), or by opening a file
export async function configureAppWithSetupEvent(data: SetupEventVariant, logger: Logger, core: dashql.DashQL, allocateConnection: ConnectionAllocator, setupWorkbook: WorkbookSetup, connections: ConnectionRegistry, setupDone: () => void): Promise<AppLinkSetupResult | null> {
    // Resolve workbook
    let catalogs: pb.dashql.catalog.Catalog[] = [];
    let workbooks: pb.dashql.workbook.Workbook[] = [];
    let setupName = "?";
    switch (data.type) {
        case SETUP_WORKBOOK:
            setupName = "SETUP_WORKBOOK";
            workbooks.push(data.value);
            break;
        case SETUP_FILE:
            setupName = "SETUP_FILE";
            catalogs = data.value.catalogs;
            workbooks = data.value.workbooks;
            break;
    }
    logger.info("starting app setup", {
        setup: setupName,
        catalogs: catalogs.length.toString(),
        workbooks: workbooks.length.toString()
    });

    // Setup connection
    for (const catalogProto of catalogs) {
        // Get the connector info for the workbook setup protobuf
        const connectorInfo = catalogProto.connectionParams ? getConnectorInfoForParams(catalogProto.connectionParams) : null;
        if (connectorInfo == null) {
            throw new LoggableException("failed to resolve the connector info from the parameters", {});
        }

        // XXX
    }

    // Setup workbooks
    for (const workbookProto of workbooks) {
        // Get the connector info for the workbook setup protobuf
        const connectorInfo = workbookProto.connectionParams ? getConnectorInfoForParams(workbookProto.connectionParams) : null;
        if (connectorInfo == null) {
            throw new LoggableException("failed to resolve the connector info from the parameters", {});
        }
        switch (workbookProto.connectionParams?.connection.case) {
            case "hyper": {
                const connWithoutId = createConnectionStateForType(core, ConnectorType.HYPER_GRPC, connections.connectionsBySignature);
                const conn = allocateConnection(connWithoutId);
                const workbook = setupWorkbook(conn);
                return {
                    type: REQUIRES_INTERACTIVE_SETUP,
                    value: {
                        connectionId: conn.connectionId,
                        connectionParams: workbookProto.connectionParams,
                        workbookId: workbook.workbookId,
                        workbookProto,
                    }
                };
            }
            case "salesforce": {
                const connWithoutId = createConnectionStateForType(core, ConnectorType.SALESFORCE_DATA_CLOUD, connections.connectionsBySignature);
                const conn = allocateConnection(connWithoutId);
                const workbook = setupWorkbook(conn);
                return {
                    type: REQUIRES_INTERACTIVE_SETUP,
                    value: {
                        connectionId: conn.connectionId,
                        connectionParams: workbookProto.connectionParams,
                        workbookId: workbook.workbookId,
                        workbookProto,
                    }
                };
            }
            case "trino": {
                const connWithoutId = createConnectionStateForType(core, ConnectorType.TRINO, connections.connectionsBySignature);
                const conn = allocateConnection(connWithoutId);
                const workbook = setupWorkbook(conn);
                return {
                    type: REQUIRES_INTERACTIVE_SETUP,
                    value: {
                        connectionId: conn.connectionId,
                        connectionParams: workbookProto.connectionParams,
                        workbookId: workbook.workbookId,
                        workbookProto,
                    }
                };
            }
            case "dataless": {
                if (connections.connectionsByType![ConnectorType.DATALESS].size == 0) {
                    throw new LoggableException("missing default dataless connection", {});
                }
                const connectionId = connections.connectionsByType![ConnectorType.DATALESS].values().next().value!;
                const conn = connections.connectionMap.get(connectionId)!;
                const workbook = setupWorkbook(conn);
                return {
                    type: FINISHED_LINK_SETUP,
                    value: {
                        workbookId: workbook.workbookId,
                        connectionId: workbook.connectionId,
                    }
                };
            }
            case "demo": {
                if (connections.connectionsByType![ConnectorType.DEMO].size == 0) {
                    throw new LoggableException("missing default demo connection", {});
                }
                const connectionId = connections.connectionsByType![ConnectorType.DEMO].values().next().value!;
                const conn = connections.connectionMap.get(connectionId)!;
                const workbook = setupWorkbook(conn);
                return {
                    type: FINISHED_LINK_SETUP,
                    value: {
                        workbookId: workbook.workbookId,
                        connectionId: workbook.connectionId,
                    }
                };
            }
        }
    }
    return null;
}
