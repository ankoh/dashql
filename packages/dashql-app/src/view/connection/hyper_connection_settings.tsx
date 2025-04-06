import * as React from 'react';
import * as symbols from '../../../static/svg/symbols.generated.svg';
import * as style from './connection_settings.module.css';

import { useNavigate } from 'react-router-dom';

import {
    ChecklistIcon,
    DatabaseIcon,
    FileBadgeIcon,
    FileSymlinkFileIcon,
    KeyIcon,
    PlugIcon,
    XIcon,
} from '@primer/octicons-react';

import { classNames } from '../../utils/classnames.js';
import { KeyValueTextField, TextField } from '../foundations/text_field.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useHyperDatabaseClient } from '../../connection/hyper/hyperdb_client_provider.js';
import { KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '../foundations/keyvalue_list.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { Dispatch } from '../../utils/variant.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { HyperGrpcConnectionParams } from '../../connection/hyper/hyper_connection_params.js';
import { getConnectionHealthIndicator, getConnectionStatusText } from './salesforce_connection_settings.js';
import { useHyperGrpcSetup } from '../../connection/hyper/hyper_connection_setup.js';
import { useConnectionWorkbookSelector } from './connection_workbook.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { requiresSwitchingToNative } from '../../connection/connector_info.js';

const LOG_CTX = "hyper_connector";

interface PageState {
    endpoint: string;
    mTlsKeyPath: string;
    mTlsPubPath: string;
    mTlsCaPath: string;
    attachedDatabases: KeyValueListElement[];
    gRPCMetadata: KeyValueListElement[];
};
type PageStateSetter = Dispatch<React.SetStateAction<PageState>>;
const PAGE_STATE_CTX = React.createContext<[PageState, PageStateSetter] | null>(null);

interface Props {
    connectionId: number;
}

export const HyperGrpcConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const hyperClient = useHyperDatabaseClient();
    const hyperSetup = useHyperGrpcSetup();
    const selectConnectionWorkbook = useConnectionWorkbookSelector();
    const navigate = useNavigate();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER_GRPC];
    const connectorRequiresSwitch = requiresSwitchingToNative(connectorInfo);

    // Wire up the page state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.connectionId);
    const [pageState, setPageState] = React.useContext(PAGE_STATE_CTX)!;
    const setEndpoint = (v: string) => setPageState(s => ({ ...s, endpoint: v }));
    const setMTLSKeyPath = (v: string) => setPageState(s => ({ ...s, mTlsKeyPath: v }));
    const setMTLSPubPath = (v: string) => setPageState(s => ({ ...s, mTlsPubPath: v }));
    const setMTLSCaPath = (v: string) => setPageState(s => ({ ...s, mTlsCaPath: v }));
    const modifyAttachedDbs: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, attachedDatabases: action(s.attachedDatabases) }));
    const modifyGrpcMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, gRPCMetadata: action(s.gRPCMetadata) }));

    // Helper to setup the connection
    const setupParams: HyperGrpcConnectionParams = React.useMemo<HyperGrpcConnectionParams>(() => ({
        channelArgs: {
            endpoint: pageState.endpoint
        },
        attachedDatabases: pageState.attachedDatabases,
        gRPCMetadata: pageState.gRPCMetadata,
    }), [pageState.endpoint, pageState.attachedDatabases, pageState.gRPCMetadata]);
    const setupAbortController = React.useRef<AbortController | null>(null);
    const setupConnection = async () => {
        // Is there a Hyper client?
        if (hyperClient == null || hyperSetup == null) {
            logger.error("Hyper connector is unavailable", {}, LOG_CTX);
            return;
        }
        // Is there a connection id?
        if (connectionState == null) {
            logger.warn("Connection state is null", {}, LOG_CTX);
            return;
        }

        try {
            // Setup the Hyper connection
            setupAbortController.current = new AbortController();
            const _channel = await hyperSetup.setup(dispatchConnectionState, setupParams, setupAbortController.current.signal);

            // Start the the inital catalog update
            // XXX

        } catch (error: any) {
            // XXX
        }

        setupAbortController.current = null;
    };

    // Helper to cancel and reset the authorization
    const cancelSetup = () => {
        if (setupAbortController.current) {
            setupAbortController.current.abort("abort the Hyper setup");
            setupAbortController.current = null;
        }
    };
    const resetSetup = async () => {
        if (hyperSetup) {
            await hyperSetup.reset(dispatchConnectionState);
        }
    };

    // Helper to switch to the editor
    const openEditor = React.useCallback(() => {
        if (connectionState != null) {
            selectConnectionWorkbook(connectionState);
            navigate("/");
        }
    }, []);

    // Get the connection status
    let statusText: string = "";
    let indicatorStatus: IndicatorStatus = IndicatorStatus.None;
    if (connectorRequiresSwitch) {
        statusText = "Connector is disabled in the browser";
        indicatorStatus = IndicatorStatus.Skip;
    } else {
        statusText = getConnectionStatusText(connectionState?.connectionStatus, logger);
        indicatorStatus = getConnectionHealthIndicator(connectionState?.connectionHealth ?? null);
    }

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    let freezeInput = false;
    switch (connectionState?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.CANCELLED:
        case ConnectionHealth.FAILED:
            connectButton = (
                <Button
                    variant={ButtonVariant.Primary}
                    leadingVisual={PlugIcon}
                    onClick={setupConnection}
                    disabled={connectorRequiresSwitch}
                >
                    Connect
                </Button>
            );
            break;
        case ConnectionHealth.CONNECTING:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={cancelSetup}>Cancel</Button>;
            freezeInput = true;
            break;
        case ConnectionHealth.ONLINE:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={resetSetup}>Disconnect</Button>;
            freezeInput = true;
            break;
    }

    return (
        <div className={style.layout}>
            <div className={style.connector_header_container}>
                <div className={style.platform_logo}>
                    <svg width="28px" height="28px">
                        <use xlinkHref={`${symbols}#hyper`} />
                    </svg>
                </div>
                <div className={style.platform_name} aria-labelledby="connector-hyper-database">
                    Hyper Database
                </div>
                <div className={style.platform_actions}>
                    {(connectionState?.connectionHealth == ConnectionHealth.ONLINE) && (
                        <Button variant={ButtonVariant.Default} leadingVisual={FileSymlinkFileIcon} onClick={openEditor}>Open Editor</Button>
                    )}
                    {connectButton}
                </div>
            </div >
            <div className={style.status_container}>
                <div className={classNames(style.section, style.status_section)}>
                    <div className={classNames(style.section_layout, style.status_section_layout)}>
                        <div className={style.status_bar}>
                            <div className={style.status_indicator}>
                                <StatusIndicator className={style.status_indicator_spinner} status={indicatorStatus} fill="black" />
                            </div>
                            <div className={style.status_text}>
                                {statusText}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="gRPC Endpoint"
                            caption="Endpoint of the gRPC service as 'https://host:port'"
                            value={pageState.endpoint}
                            placeholder="gRPC endpoint url"
                            leadingVisual={() => <div>URL</div>}
                            onChange={(e) => setEndpoint(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            logContext={LOG_CTX}
                        />
                        <KeyValueTextField
                            className={style.grid_column_1}
                            name="mTLS Client Key"
                            caption="Paths to client key and client certificate"
                            k={pageState.mTlsKeyPath}
                            v={pageState.mTlsPubPath}
                            keyPlaceholder="client.key"
                            valuePlaceholder="client.pem"
                            keyIcon={KeyIcon}
                            valueIcon={FileBadgeIcon}
                            onChangeKey={(e) => setMTLSKeyPath(e.target.value)}
                            onChangeValue={(e) => setMTLSPubPath(e.target.value)}
                            keyAriaLabel='mTLS Client Key'
                            valueAriaLabel='mTLS Client Certificate'
                            logContext={LOG_CTX}
                            disabled={true}
                            readOnly={true}
                        />
                        <TextField
                            name="mTLS CA certificates"
                            caption="Path to certificate authority (CA) certificates"
                            value={pageState.mTlsCaPath}
                            placeholder="cacerts.pem"
                            leadingVisual={ChecklistIcon}
                            onChange={(e) => setMTLSCaPath(e.target.value)}
                            logContext={LOG_CTX}
                            disabled={true}
                            readOnly={true}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <KeyValueListBuilder
                            className={style.grid_column_1}
                            title="Attached Databases"
                            caption="Databases that are attached for every query"
                            keyIcon={DatabaseIcon}
                            valueIcon={() => <div>ID</div>}
                            addButtonLabel="Add Database"
                            elements={pageState.attachedDatabases}
                            modifyElements={modifyAttachedDbs}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                        <KeyValueListBuilder
                            title="gRPC Metadata"
                            caption="Extra HTTP headers that are added to each request"
                            keyIcon={() => <div>Header</div>}
                            valueIcon={() => <div>Value</div>}
                            addButtonLabel="Add Header"
                            elements={pageState.gRPCMetadata}
                            modifyElements={modifyGrpcMetadata}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
            </div>
        </ div>
    );
};

interface ProviderProps { children: React.ReactElement };

export const HyperGrpcConnectorSettingsStateProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const state = React.useState<PageState>({
        endpoint: "http://localhost:7484",
        mTlsKeyPath: "",
        mTlsPubPath: "",
        mTlsCaPath: "",
        attachedDatabases: [],
        gRPCMetadata: [],
    });
    return (
        <PAGE_STATE_CTX.Provider value={state}>
            {props.children}
        </PAGE_STATE_CTX.Provider>
    );
};
