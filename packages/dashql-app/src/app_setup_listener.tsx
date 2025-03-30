import * as pb from '@ankoh/dashql-protobuf';
import * as React from 'react';

import { ConnectionSetupPage } from './view/connection/connection_setup_page.js';
import { ConnectorType, getConnectorInfoForParams } from './connection/connector_info.js';
import { SETUP_FILE, SETUP_WORKBOOK, SetupEventVariant } from './platform/event.js';
import { createConnectionStateForType } from './connection/connection_state.js';
import { isDebugBuild } from './globals.js';
import { useAwaitStateChange } from './utils/state_change.js';
import { useConnectionRegistry, useConnectionStateAllocator } from './connection/connection_registry.js';
import { useCurrentWorkbookSelector } from './workbook/current_workbook.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { useDefaultConnections } from './connection/default_connections.js';
import { useLogger } from './platform/logger_provider.js';
import { usePlatformEventListener } from './platform/event_listener_provider.js';
import { useWorkbookRegistry } from './workbook/workbook_state_registry.js';
import { useWorkbookSetup } from './workbook/workbook_setup.js';

enum AppSetupDecision {
    UNDECIDED,
    SHOW_CONNECTION_SETUP,
    SETUP_DONE,
}

interface AppSetupArgs {
    connectionId: number;
    connectionParams: pb.dashql.connection.ConnectionParams;
    workbookId: number;
    workbookProto: pb.dashql.workbook.Workbook;
}

interface AppSetupState {
    decision: AppSetupDecision;
    args: AppSetupArgs | null;
}

export const AppSetupListener: React.FC<{ children: React.ReactElement }> = (props: { children: React.ReactElement }) => {
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const allocateConnectionState = useConnectionStateAllocator();
    const connReg = useConnectionRegistry();
    const selectWorkbook = useCurrentWorkbookSelector();
    const setupWorkbook = useWorkbookSetup();

    const defaultConnections = useDefaultConnections();
    const awaitDefaultConnections = useAwaitStateChange(defaultConnections);

    const appEvents = usePlatformEventListener();
    const abortDefaultWorkbookSwitch = React.useRef(new AbortController());

    // State to decide about workbook setup strategy
    const [state, setState] = React.useState<AppSetupState>(() => ({
        decision: AppSetupDecision.UNDECIDED,
        args: null,
    }));

    // Configure catalog and workbooks
    const runSetup = React.useCallback(async (data: SetupEventVariant) => {
        const core = await setupCore("app_setup");

        // Stop the default workbook switch after DashQL is ready
        abortDefaultWorkbookSwitch.current.abort("workbook_setup_event");
        // Await the setup of the default connections
        const defaultConns = (await awaitDefaultConnections(s => s != null))!;

        // Resolve workbook
        let catalogs: pb.dashql.file.FileCatalog[] = [];
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
                    const connWithoutId = createConnectionStateForType(core, ConnectorType.HYPER_GRPC);
                    const conn = allocateConnectionState(connWithoutId);
                    const workbook = setupWorkbook(conn);
                    setState({
                        decision: AppSetupDecision.SHOW_CONNECTION_SETUP,
                        args: {
                            connectionId: conn.connectionId,
                            connectionParams: workbookProto.connectionParams,
                            workbookId: workbook.workbookId,
                            workbookProto,
                        },
                    });
                    break;
                }
                case "salesforce": {
                    const connWithoutId = createConnectionStateForType(core, ConnectorType.SALESFORCE_DATA_CLOUD);
                    const conn = allocateConnectionState(connWithoutId);
                    const workbook = setupWorkbook(conn);
                    setState({
                        decision: AppSetupDecision.SHOW_CONNECTION_SETUP,
                        args: {
                            connectionId: conn.connectionId,
                            connectionParams: workbookProto.connectionParams,
                            workbookId: workbook.workbookId,
                            workbookProto,
                        },
                    });
                    break;
                }
                case "trino": {
                    const connWithoutId = createConnectionStateForType(core, ConnectorType.TRINO);
                    const conn = allocateConnectionState(connWithoutId);
                    const workbook = setupWorkbook(conn);
                    setState({
                        decision: AppSetupDecision.SHOW_CONNECTION_SETUP,
                        args: {
                            connectionId: conn.connectionId,
                            connectionParams: workbookProto.connectionParams,
                            workbookId: workbook.workbookId,
                            workbookProto,
                        },
                    });
                    return;
                }
                case "serverless": {
                    const connectionId = defaultConns!.hyper;
                    const conn = connReg.connectionMap.get(connectionId)!;
                    const workbook = setupWorkbook(conn);
                    selectWorkbook(workbook.workbookId);
                    setState({
                        decision: AppSetupDecision.SETUP_DONE,
                        args: null,
                    });
                    return;
                }
                case "demo": {
                    const connectionId = defaultConns!.demo;
                    const conn = connReg.connectionMap.get(connectionId)!;
                    const workbook = setupWorkbook(conn);
                    selectWorkbook(workbook.workbookId);
                    setState({
                        decision: AppSetupDecision.SETUP_DONE,
                        args: null,
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

    // Effect to switch to default workbook after setup
    const workbookRegistry = useWorkbookRegistry();
    const awaitDefaultWorkbooks = useAwaitStateChange(workbookRegistry);

    React.useEffect(() => {
        const selectDefaultWorkbook = async () => {
            // Await the setup of the default connections
            const defaultConns = (await awaitDefaultConnections(s => s != null))!;
            // Await the setup of default workbooks
            await awaitDefaultWorkbooks(s => {
                const hasServerless = (s.workbooksByConnection.get(defaultConns.serverless)?.length ?? 0) > 0;
                const hasDemo = (s.workbooksByConnection.get(defaultConns.demo)?.length ?? 0) > 0;
                return hasServerless && (hasDemo || !isDebugBuild());
            });
            const serverlessWorkbooks = workbookRegistry.workbooksByConnection.get(defaultConns.serverless)!;
            const demoWorkbooks = workbookRegistry.workbooksByConnection.get(defaultConns.demo) ?? [];

            // Await the setup of the static workbooks
            // We might have received a workbook setup link in the meantime.
            // In that case, don't default-select the serverless workbook
            if (abortDefaultWorkbookSwitch.current.signal.aborted) {
                return;
            }
            // Be extra careful not to override a selected workbook
            const d = isDebugBuild()
                ? demoWorkbooks[0]
                : serverlessWorkbooks[0];
            selectWorkbook(s => (s == null) ? d : s);
            // Skip the setup
            setState({
                decision: AppSetupDecision.SETUP_DONE,
                args: null,
            });
        };
        selectDefaultWorkbook();
    }, []);

    // Determine what we want to render
    let child: React.ReactElement = <div />;
    switch (state.decision) {
        case AppSetupDecision.UNDECIDED:
            break;
        case AppSetupDecision.SHOW_CONNECTION_SETUP: {
            const args = state.args!;
            child = <ConnectionSetupPage
                connectionId={args.connectionId}
                connectionParams={args.connectionParams}
                workbookProto={args.workbookProto}
                onDone={() => setState(s => ({ ...s, decision: AppSetupDecision.SETUP_DONE }))}
            />;
            break;
        }
        case AppSetupDecision.SETUP_DONE:
            child = props.children;
            break;
    }
    return child;
};
