import * as React from 'react';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as buf from '@bufbuild/protobuf';
import * as pb from '../../proto.js';
import * as style from './connection_settings.module.css';

import {
    ChecklistIcon,
    DatabaseIcon,
    FileBadgeIcon,
    KeyIcon,
} from '@primer/octicons-react';

import { classNames } from '../../utils/classnames.js';
import { KeyValueTextField, TextField } from '../foundations/text_field.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useHyperDatabaseClient } from '../../connection/hyper/hyperdb_grpc_client_provider.js';
import { flattenKeyValueList, KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '../foundations/keyvalue_list.js';
import { Dispatch } from '../../utils/variant.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { useHyperSetup } from '../../connection/hyper/hyper_connection_setup.js';
import { useAnyConnectionNotebook } from './connection_notebook.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { isNativePlatform } from '../../platform/native_globals.js';
import { ConnectionInlineHeader } from './connection_inline_header.js';

const LOG_CTX = "hyper_connector";

interface PageState {
    protocol: connection.HyperProtocol;
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
    sessionId: string | null;
    onClose?: () => void;
}

export const HyperConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const hyperClient = useHyperDatabaseClient();
    const hyperSetup = useHyperSetup();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER];

    // Wire up the page state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.sessionId);
    const connectionNotebook = useAnyConnectionNotebook(props.sessionId);

    const [pageState, setPageState] = React.useContext(PAGE_STATE_CTX)!;
    const protocol = pageState.protocol;

    // gRPC requires the native platform
    const wrongPlatform = protocol === "V3_GRPC" && !isNativePlatform();
    const setProtocol = (v: connection.HyperProtocol) => setPageState(s => ({ ...s, protocol: v }));
    const setEndpoint = (v: string) => setPageState(s => ({ ...s, endpoint: v }));
    const setMTLSKeyPath = (v: string) => setPageState(s => ({ ...s, mTlsKeyPath: v }));
    const setMTLSPubPath = (v: string) => setPageState(s => ({ ...s, mTlsPubPath: v }));
    const setMTLSCaPath = (v: string) => setPageState(s => ({ ...s, mTlsCaPath: v }));
    const modifyAttachedDbs: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, attachedDatabases: action(s.attachedDatabases) }));
    const modifyGrpcMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, gRPCMetadata: action(s.gRPCMetadata) }));
    const isGrpc = protocol === "V3_GRPC";

    // Helper to setup the connection
    const setupParams = React.useMemo<connection.HyperConnectionParams>(() => ({
        protocol: pageState.protocol,
        endpoint: pageState.endpoint,
        tls: {
            clientKeyPath: "",
            clientCertPath: "",
            caCertsPath: ""
        },
        attachedDatabases: pageState.attachedDatabases.map(v => buf.create(pb.salesforce_hyperdb_grpc_v1.pb.AttachedDatabaseSchema, {
            path: v.key,
            alias: v.value,
        })),
        metadata: {
            message: "",
            details: flattenKeyValueList(pageState.gRPCMetadata)
        } as any,
    }), [pageState.protocol, pageState.endpoint, pageState.attachedDatabases, pageState.gRPCMetadata]);
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

    // Get the action button
    let freezeInput = false;
    switch (connectionState?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.CANCELLED:
        case ConnectionHealth.FAILED:
            break;
        case ConnectionHealth.CONNECTING:
            freezeInput = true;
            break;
        case ConnectionHealth.ONLINE:
            freezeInput = true;
            break;
    }

    return (
        <div className={style.layout}>
            <ConnectionInlineHeader
                connector={connectorInfo}
                connection={connectionState}
                wrongPlatform={wrongPlatform}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                notebook={connectionNotebook}
                protocol={protocol}
                onProtocolChange={setProtocol}
                freezeInput={freezeInput}
                onClose={props.onClose}
            />
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name={isGrpc ? "gRPC Endpoint" : "HTTP Endpoint"}
                            caption={isGrpc
                                ? "Endpoint of the gRPC service as 'https://host:port'"
                                : "Endpoint of the HTTP service as 'https://host:port'"
                            }
                            value={pageState.endpoint}
                            placeholder={isGrpc ? "gRPC endpoint url" : "HTTP endpoint url"}
                            leadingVisual={() => <div>URL</div>}
                            onChange={(e) => setEndpoint(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            logContext={LOG_CTX}
                        />
                        {isGrpc && <KeyValueTextField
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
                        />}
                        {isGrpc && <TextField
                            name="mTLS CA certificates"
                            caption="Path to certificate authority (CA) certificates"
                            value={pageState.mTlsCaPath}
                            placeholder="cacerts.pem"
                            leadingVisual={ChecklistIcon}
                            onChange={(e) => setMTLSCaPath(e.target.value)}
                            logContext={LOG_CTX}
                            disabled={true}
                            readOnly={true}
                        />}
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
                            title={isGrpc ? "gRPC Metadata" : "HTTP Headers"}
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

export const HyperConnectorSettingsStateProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const state = React.useState<PageState>({
        protocol: "V3_HTTP",
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
