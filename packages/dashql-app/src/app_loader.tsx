import * as React from 'react';
import * as pb from '@ankoh/dashql-protobuf';

import { AppLoadingStatus } from './app_loading_status.js';
import { ConnectionSetupPage } from './view/connection/connection_setup_page.js';
import { ConnectorType, getConnectorInfoForParams } from './connection/connector_info.js';
import { FINISH_SETUP, useRouteContext, useRouterNavigate } from './router.js';
import { SETUP_FILE, SETUP_WORKBOOK, SetupEventVariant } from './platform/event.js';
import { createConnectionStateForType } from './connection/connection_state.js';
import { isDebugBuild } from './globals.js';
import { useAwaitStateChange } from './utils/state_change.js';
import { useConnectionRegistry, useConnectionStateAllocator } from './connection/connection_registry.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { useDefaultConnections } from './connection/default_connections.js';
import { useLogger } from './platform/logger_provider.js';
import { usePlatformEventListener } from './platform/event_listener_provider.js';
import { useWorkbookRegistry } from './workbook/workbook_state_registry.js';
import { useWorkbookSetup } from './workbook/workbook_setup.js';
import { AppLoadingPage } from './view/app_loading_page.js';

interface AppSetupArgs {
    connectionId: number;
    connectionParams: pb.dashql.connection.ConnectionParams;
    workbookId: number;
    workbookProto: pb.dashql.workbook.Workbook;
}

interface Props {
    children: React.ReactElement;
}

export const AppLoader: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const route = useRouteContext();
    const setupCore = useDashQLCoreSetup();
    const setupWorkbook = useWorkbookSetup();
    const allocateConnection = useConnectionStateAllocator();
    const [connReg, _setConnReg] = useConnectionRegistry();

    const defaultConnections = useDefaultConnections();
    const awaitDefaultConnections = useAwaitStateChange(defaultConnections);

    const appEvents = usePlatformEventListener();
    const abortDefaultWorkbookSwitch = React.useRef(new AbortController());

    // State to decide about workbook setup strategy
    const [setupArgs, setSetupArgs] = React.useState<AppSetupArgs | null>(null);

    // Configure catalog and workbooks
    const runSetup = React.useCallback(async (data: SetupEventVariant) => {
        // Stop the default workbook switch after DashQL is ready
        abortDefaultWorkbookSwitch.current.abort("workbook_setup_event");

        // Setup core
        const core = await setupCore("app_setup");
        // Await the setup of the default connections
        const defaultConns = (await awaitDefaultConnections(s => s.length > 0))!;

        // Resolve workbook
        let catalogs: pb.dashql.catalog.Catalog[] = [];
        let workbooks: pb.dashql.workbook.Workbook[] = [];
        switch (data.type) {
            case SETUP_WORKBOOK:
                workbooks.push(data.value);
                break;
            case SETUP_FILE:
                catalogs = data.value.catalogs;
                workbooks = data.value.workbooks;
                break;
        }

        // Setup connection
        for (const catalogProto of catalogs) {
            // Get the connector info for the workbook setup protobuf
            const connectorInfo = catalogProto.connectionParams ? getConnectorInfoForParams(catalogProto.connectionParams) : null;
            if (connectorInfo == null) {
                logger.warn("failed to resolve the connector info from the parameters", {});
                continue;
            }

            // XXX
        }

        // Setup workbooks
        for (const workbookProto of workbooks) {
            // Get the connector info for the workbook setup protobuf
            const connectorInfo = workbookProto.connectionParams ? getConnectorInfoForParams(workbookProto.connectionParams) : null;
            if (connectorInfo == null) {
                logger.warn("failed to resolve the connector info from the parameters", {});
                return;
            }
            switch (workbookProto.connectionParams?.connection.case) {
                case "hyper": {
                    const connWithoutId = createConnectionStateForType(core, ConnectorType.HYPER_GRPC, connReg.connectionsBySignature);
                    const conn = allocateConnection(connWithoutId);
                    const workbook = setupWorkbook(conn);
                    setSetupArgs({
                        connectionId: conn.connectionId,
                        connectionParams: workbookProto.connectionParams,
                        workbookId: workbook.workbookId,
                        workbookProto,
                    });
                    break;
                }
                case "salesforce": {
                    const connWithoutId = createConnectionStateForType(core, ConnectorType.SALESFORCE_DATA_CLOUD, connReg.connectionsBySignature);
                    const conn = allocateConnection(connWithoutId);
                    const workbook = setupWorkbook(conn);
                    setSetupArgs({
                        connectionId: conn.connectionId,
                        connectionParams: workbookProto.connectionParams,
                        workbookId: workbook.workbookId,
                        workbookProto,
                    });
                    break;
                }
                case "trino": {
                    const connWithoutId = createConnectionStateForType(core, ConnectorType.TRINO, connReg.connectionsBySignature);
                    const conn = allocateConnection(connWithoutId);
                    const workbook = setupWorkbook(conn);
                    setSetupArgs({
                        connectionId: conn.connectionId,
                        connectionParams: workbookProto.connectionParams,
                        workbookId: workbook.workbookId,
                        workbookProto,
                    });
                    return;
                }
                case "dataless": {
                    const connectionId = defaultConns![ConnectorType.HYPER_GRPC];
                    const conn = connReg.connectionMap.get(connectionId)!;
                    const workbook = setupWorkbook(conn);
                    navigate({
                        type: FINISH_SETUP,
                        value: {
                            workbookId: workbook.workbookId,
                            connectionId: workbook.connectionId,
                        }
                    });
                    return;
                }
                case "demo": {
                    const connectionId = defaultConns![ConnectorType.DEMO];
                    const conn = connReg.connectionMap.get(connectionId)!;
                    const workbook = setupWorkbook(conn);
                    navigate({
                        type: FINISH_SETUP,
                        value: {
                            workbookId: workbook.workbookId,
                            connectionId: workbook.connectionId,
                        }
                    });
                    return;
                }
            }
        }
    }, []);

    // Register an event handler for setup events.
    // The user may either paste a deep link through the clipboard, or may run a setup through a deep link.
    React.useEffect(() => {
        // Subscribe to setup events
        appEvents.subscribeSetupEvents(runSetup);
        // Remove listener as soon as this component unmounts
        return () => {
            appEvents.unsubscribeSetupEvents(runSetup);
        };
    }, [appEvents]);

    const [workbookRegistry, _modifyWorkbooks] = useWorkbookRegistry();
    const awaitWorkbooks = useAwaitStateChange(workbookRegistry);

    // Effect to run the default setup once at the beginning
    // React.useEffect(() => {
    //     const selectDefaultWorkbook = async () => {
    //         let workbookId: number;
    //         let connectionId: number;

    //         // Is debug build?
    //         if (isDebugBuild()) {
    //             // Await the setup of the demo workbook
    //             const workbooks = await awaitWorkbooks(s => s.workbooksByConnectionType[ConnectorType.DEMO].length > 0);
    //             workbookId = workbooks.workbooksByConnectionType[ConnectorType.DEMO][0];
    //             connectionId = workbooks.workbookMap.get(workbookId)!.connectionId;
    //         } else {
    //             // Await the setup of the dataless workbook
    //             const workbooks = await awaitWorkbooks(s => s.workbooksByConnectionType[ConnectorType.DATALESS].length > 0);
    //             workbookId = workbooks.workbooksByConnectionType[ConnectorType.DATALESS][0];
    //             connectionId = workbooks.workbookMap.get(workbookId)!.connectionId;
    //         }

    //         // Await the setup of the static workbooks
    //         // We might have received a workbook setup link in the meantime.
    //         // In that case, don't default-select the dataless workbook
    //         if (abortDefaultWorkbookSwitch.current.signal.aborted) {
    //             return;
    //         }

    //         // Mark setup as done
    //         navigate({
    //             type: FINISH_SETUP,
    //             value: {
    //                 workbookId: workbookId,
    //                 connectionId: connectionId,
    //             }
    //         });
    //     };
    //     selectDefaultWorkbook();
    // }, []);

    // Setup done?
    if (route.appLoadingStatus == AppLoadingStatus.SETUP_DONE) {
        return props.children;
    } else {
        return <AppLoadingPage />;
    }
    // } else if (setupArgs != null) {
    //     return (
    //         <ConnectionSetupPage
    //             connectionId={setupArgs.connectionId}
    //             connectionParams={setupArgs.connectionParams}
    //             workbookProto={setupArgs.workbookProto}
    //         />
    //     );
    // } else {
    //     return <div />;
    // }
};
