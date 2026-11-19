import * as React from 'react';
import * as connection from '@akohn/dashql-jsonschema/connection.js';
import * as buf from '@bufbuild/protobuf';
import * as pb from '@akohn/dashql/platform/proto';
import * as style from './connection_settings.module.css';

import { ChecklistIcon, DatabaseIcon, FileBadgeIcon, KeyIcon } from '../ui/foundations/symbol_icon.js';

import { classNames } from '../utils/classnames.js';
import {
    KeyValueTextField,
    TextField,
    TextFieldValidationStatus,
    VALIDATION_ERROR,
    VALIDATION_UNKNOWN,
} from '../ui/foundations/text_field.js';
import { useLogger } from '../platform/logger_provider.js';
import { useHyperGrpcClient } from './hyper/hyperdb_grpc_client_provider.js';
import { flattenKeyValueList, KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '../ui/foundations/keyvalue_list.js';
import { Dispatch } from '@akohn/dashql/platform/utils/variant';
import { useConnectionDraftForm } from './connection_draft.js';
import { useConnection } from '@akohn/dashql-react/hooks';
import { useConnectionSave } from './connection_persistence.js';
import { useConnectionSetup } from './connection_setup.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { isDesktopHost } from '../platform/native_globals.js';
import { ConnectionInlineHeader } from './connection_inline_header.js';
import { HYPERDB_WASM_ENGINE_SETTINGS } from '@akohn/dashql/platform/hyperdb/hyperdb_settings';
import { DEFAULT_HYPER_ENDPOINT } from '@akohn/dashql/platform/connections/connection_params';
import { isHyperWasmConnection } from './connection_label.js';
import { isLocalCloud } from './cloud_connection.js';

const LOG_CTX = "hyper_connector";

const HyperEngineArgumentPrefix: React.FC = () => <span className={style.engine_argument_token}>--</span>;
const HyperEngineArgumentDelimiter: React.FC = () => <span className={style.engine_argument_token}>=</span>;

export const HYPERDB_WASM_ENGINE_SETTING_ELEMENTS: readonly KeyValueListElement[] = Object.freeze(
    Object.entries(HYPERDB_WASM_ENGINE_SETTINGS).map(([key, value]) => Object.freeze({
        key,
        value: typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
    })),
);

export interface HyperConnectionPageState {
    protocol: connection.HyperProtocol;
    endpoint: string;
    mTlsKeyPath: string;
    mTlsPubPath: string;
    mTlsCaPath: string;
    attachedDatabases: KeyValueListElement[];
    gRPCMetadata: KeyValueListElement[];
    queryParameters: KeyValueListElement[];
};

export function buildHyperConnectionPageState(params: connection.HyperConnectionParams | undefined): HyperConnectionPageState {
    const metadata = params?.metadata ?? {};
    return {
        protocol: params?.protocol ?? "WASM",
        endpoint: params?.endpoint ?? DEFAULT_HYPER_ENDPOINT,
        mTlsKeyPath: params?.tls?.clientKeyPath ?? "",
        mTlsPubPath: params?.tls?.clientCertPath ?? "",
        mTlsCaPath: params?.tls?.caCertsPath ?? "",
        attachedDatabases: (params?.attachedDatabases ?? []).map((db: any) => ({
            key: db?.path ?? "",
            value: db?.alias ?? "",
        })),
        gRPCMetadata: params?.draftRows?.metadata ?? Object.entries(metadata).map(([k, v]) => ({ key: k, value: v ?? "" })),
        queryParameters: params?.draftRows?.queryParameters ?? Object.entries(params?.queryParameters ?? {}).map(([k, v]) => ({ key: k, value: v ?? "" })),
    };
}

export function buildHyperConnectionSetupParams(pageState: HyperConnectionPageState): connection.HyperConnectionParams {
    return {
        protocol: pageState.protocol,
        endpoint: pageState.endpoint,
        tls: {
            clientKeyPath: pageState.mTlsKeyPath,
            clientCertPath: pageState.mTlsPubPath,
            caCertsPath: pageState.mTlsCaPath,
        },
        attachedDatabases: pageState.attachedDatabases.map(v => buf.create(pb.salesforce_hyperdb_grpc_v1.pb.AttachedDatabaseSchema, {
            path: v.key,
            alias: v.value,
        })),
        metadata: flattenKeyValueList(pageState.gRPCMetadata),
        queryParameters: flattenKeyValueList(pageState.queryParameters),
    };
}

interface Props {
    connectionId: string | null;
    onClose?: () => void;
}

export const HyperConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const grpcClient = useHyperGrpcClient();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER];

    // Wire up the page state
    const connectionState = useConnection(props.connectionId);
    const connectionSetup = useConnectionSetup(props.connectionId);
    const { saving } = useConnectionSave(props.connectionId);

    const [pageState, setPageState] = useConnectionDraftForm(props.connectionId,
        params => buildHyperConnectionPageState(params && 'hyper' in params ? params.hyper as connection.HyperConnectionParams : undefined),
        form => ({ hyper: { ...buildHyperConnectionSetupParams(form), draftRows: { metadata: form.gRPCMetadata, queryParameters: form.queryParameters } } }));

    const protocol = pageState.protocol;

    const wrongPlatform = protocol === "V3_GRPC" && !isDesktopHost();
    // The app holds a single connection to the embedded Hyper, connections don't switch between it and a server. A local
    // cloud runs on the embedded Hyper as well.
    const embedded = connectionState != null && (isHyperWasmConnection(connectionState) || isLocalCloud(connectionState.params));
    // A connection to the Hyper of a link takes its endpoint from the link, it doesn't switch to another protocol
    const linked = protocol === "V3_HTTP_LINK";
    const protocols: connection.HyperProtocol[] = embedded
        ? ["WASM"]
        : linked ? ["V3_HTTP_LINK"] : isDesktopHost() ? ["V3_GRPC", "V3_HTTP"] : ["V3_HTTP"];
    const setProtocol = (v: connection.HyperProtocol) => setPageState(s => ({ ...s, protocol: v }));
    const setEndpoint = (v: string) => setPageState(s => ({ ...s, endpoint: v }));
    const setMTLSKeyPath = (v: string) => setPageState(s => ({ ...s, mTlsKeyPath: v }));
    const setMTLSPubPath = (v: string) => setPageState(s => ({ ...s, mTlsPubPath: v }));
    const setMTLSCaPath = (v: string) => setPageState(s => ({ ...s, mTlsCaPath: v }));
    const modifyAttachedDbs: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, attachedDatabases: action(s.attachedDatabases) }));
    const modifyGrpcMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, gRPCMetadata: action(s.gRPCMetadata) }));
    const modifyQueryParameters: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, queryParameters: action(s.queryParameters) }));
    const isGrpc = protocol === "V3_GRPC";
    const [clientIdentityValidation, setClientIdentityValidation] = React.useState<TextFieldValidationStatus>({
        type: VALIDATION_UNKNOWN,
        value: null,
    });
    const [endpointValidation, setEndpointValidation] = React.useState<TextFieldValidationStatus>({
        type: VALIDATION_UNKNOWN,
        value: null,
    });

    React.useEffect(() => {
        setClientIdentityValidation({ type: VALIDATION_UNKNOWN, value: null });
        setEndpointValidation({ type: VALIDATION_UNKNOWN, value: null });
    }, [connectionState?.paramsDraft, pageState.protocol, pageState.endpoint, pageState.mTlsKeyPath, pageState.mTlsPubPath, pageState.mTlsCaPath]);

    // Helper to setup the connection
    const setupParams = React.useMemo<connection.HyperConnectionParams>(() => buildHyperConnectionSetupParams(pageState), [pageState]);
    const setupConnection = async () => {
        const hasTlsPaths = Boolean(pageState.mTlsKeyPath || pageState.mTlsPubPath || pageState.mTlsCaPath);
        let isHttps = false;
        try {
            isHttps = new URL(pageState.endpoint).protocol === "https:";
        } catch {
            // Endpoint parsing and error reporting remain part of connection setup.
        }
        if (isGrpc && hasTlsPaths && !isHttps) {
            setEndpointValidation({
                type: VALIDATION_ERROR,
                value: "TLS certificate paths require an https:// endpoint",
            });
            return;
        }
        if (isGrpc && Boolean(pageState.mTlsKeyPath) !== Boolean(pageState.mTlsPubPath)) {
            setClientIdentityValidation({
                type: VALIDATION_ERROR,
                value: "Client key and certificate paths must both be provided",
            });
            return;
        }
        setClientIdentityValidation({ type: VALIDATION_UNKNOWN, value: null });

        // Is there a Hyper client? The runtime speaks the HTTP API itself.
        if (isGrpc && !grpcClient) {
            logger.error("Hyper connector is unavailable", {}, LOG_CTX);
            return;
        }
        // Is there a connection id?
        if (connectionState == null) {
            logger.warn("Connection state is null", {}, LOG_CTX);
            return;
        }

        // The setup and the health check update the connection state with the failure details
        await connectionSetup.run({ hyper: setupParams });
    };
    const cancelSetup = connectionSetup.cancel;
    const resetSetup = connectionSetup.reset;

    // Get the action button
    // Saving writes the settings into every workbook that uses the connection
    let freezeInput = saving;
    switch (connectionState?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.CANCELLED:
        case ConnectionHealth.FAILED:
            break;
        case ConnectionHealth.CONNECTING:
            freezeInput = true;
            break;
        case ConnectionHealth.ONLINE:
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
                protocol={protocol}
                protocols={protocols}
                onProtocolChange={setProtocol}
                freezeInput={freezeInput}
                embedded={protocol === 'WASM'}
                onClose={props.onClose}
            />
            {protocol === 'WASM' ? (
                <div className={style.body_container}>
                    <div className={style.section}>
                        <div className={`${style.section_layout} ${style.body_section_layout}`}>
                            <KeyValueListBuilder
                                className={style.grid_column_1_span_2}
                                title="Engine Settings"
                                caption="Settings used to initialize the embedded Hyper engine"
                                keyIcon={HyperEngineArgumentPrefix}
                                valueIcon={HyperEngineArgumentDelimiter}
                                addButtonLabel="Add Setting"
                                elements={HYPERDB_WASM_ENGINE_SETTING_ELEMENTS}
                                modifyElements={() => { }}
                                disabled
                                readOnly
                                sideBySide
                                copyValue={({ key, value }) => `--${key}=${value}`}
                                copyLogContext={LOG_CTX}
                            />
                            {pageState.attachedDatabases.length > 0 && (
                                // The embedded Hyper attaches databases of the OPFS folder of the app, e.g. the local cloud
                                <KeyValueListBuilder
                                    className={style.grid_column_1_span_2}
                                    title="Attached Databases"
                                    caption="Databases in this browser that are attached next to the own one, e.g. the local cloud"
                                    keyIcon={DatabaseIcon}
                                    valueIcon={() => <div>ID</div>}
                                    addButtonLabel="Add Database"
                                    elements={pageState.attachedDatabases}
                                    modifyElements={() => { }}
                                    disabled
                                    readOnly
                                />
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className={style.body_container}>
                    <div className={style.section}>
                        <div className={classNames(style.section_layout, style.body_section_layout)}>
                            {linked ? (
                                <TextField
                                    name="HTTP Endpoint"
                                    caption="Endpoint of the link that the app was opened with, e.g. by 'hyperd run --ui'"
                                    value={pageState.endpoint}
                                    placeholder="Open a link to connect"
                                    leadingVisual={() => <div>URL</div>}
                                    onChange={() => { }}
                                    disabled
                                    readOnly
                                    logContext={LOG_CTX}
                                />
                            ) : (
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
                                    validation={endpointValidation}
                                    logContext={LOG_CTX}
                                />
                            )}
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
                                validation={clientIdentityValidation}
                                disabled={freezeInput}
                                readOnly={freezeInput}
                            />}
                            {isGrpc && <TextField
                                name="mTLS CA certificates"
                                caption="Path to certificate authority (CA) certificates"
                                value={pageState.mTlsCaPath}
                                placeholder="cacerts.pem"
                                leadingVisual={ChecklistIcon}
                                onChange={(e) => setMTLSCaPath(e.target.value)}
                                logContext={LOG_CTX}
                                disabled={freezeInput}
                                readOnly={freezeInput}
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
                            <KeyValueListBuilder
                                title="Query Settings"
                                caption="Attached database settings that are added to every query"
                                keyIcon={() => <div>Name</div>}
                                valueIcon={() => <div>Value</div>}
                                addButtonLabel="Add Setting"
                                elements={pageState.queryParameters}
                                modifyElements={modifyQueryParameters}
                                disabled={freezeInput}
                                readOnly={freezeInput}
                            />
                        </div>
                    </div>
                </div>
            )}
        </ div>
    );
};
