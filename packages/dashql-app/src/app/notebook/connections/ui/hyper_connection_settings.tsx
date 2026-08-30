import * as React from 'react';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as buf from '@bufbuild/protobuf';
import * as pb from '../../../../proto.js';
import * as style from './connection_settings.module.css';

import { ChecklistIcon, CircleSlashIcon, DashIcon, DatabaseIcon, FileBadgeIcon, KeyIcon, PlusIcon } from '../../../../ui/foundations/symbol_icon.js';

import { ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';

import { classNames } from '../../../../utils/classnames.js';
import {
    KeyValueTextField,
    TextField,
    TextFieldValidationStatus,
    VALIDATION_ERROR,
    VALIDATION_UNKNOWN,
} from '../../../../ui/foundations/text_field.js';
import { useLogger } from '../../../../platform/logger/logger_provider.js';
import { useHyperGrpcClient, useHyperHttpClient } from '../hyper/hyperdb_grpc_client_provider.js';
import { flattenKeyValueList, KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '../../../../ui/foundations/keyvalue_list.js';
import { Dispatch } from '../../../../utils/variant.js';
import { useConnectionState } from '../connection_registry.js';
import { ConnectionHealth } from '../connection_state.js';
import { performHealthCheck } from '../health_check.js';
import { useHyperSetup } from '../hyper/hyper_connection_setup.js';
import { getHyperConnectionDetails } from '../hyper/hyper_connection_state.js';
import { useQueryExecutor } from '../query_executor.js';
import { useAnyConnectionNotebookScripts } from './connection_notebook_scripts.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { isNativePlatform } from '../../../../platform/native_globals.js';
import { ConnectionInlineHeader } from './connection_inline_header.js';
import { HyperDockerPanelMode, HyperDockerSettingsPanel } from './hyper_docker_settings.js';
import { HYPERDB_WASM_ENGINE_SETTINGS } from '../../../../platform/hyperdb/hyperdb_settings.js';

const LOG_CTX = "hyper_connector";

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

function readHyperConnectionMetadata(params: connection.HyperConnectionParams | undefined): Record<string, string> {
    const metadata = params?.metadata as unknown;
    if (!metadata || typeof metadata !== "object") return {};

    // Read notebooks written before Hyper metadata was aligned with its flat-map schema.
    const legacyMetadata = metadata as { details?: unknown; data?: unknown };
    const nested = legacyMetadata.details ?? legacyMetadata.data;
    if (nested && typeof nested === "object") {
        return nested as Record<string, string>;
    }
    return metadata as Record<string, string>;
}

export function buildHyperConnectionPageState(params: connection.HyperConnectionParams | undefined): HyperConnectionPageState {
    const metadata = readHyperConnectionMetadata(params);
    return {
        protocol: params?.protocol ?? "WASM",
        endpoint: params?.endpoint ?? "http://localhost:7484",
        mTlsKeyPath: params?.tls?.clientKeyPath ?? "",
        mTlsPubPath: params?.tls?.clientCertPath ?? "",
        mTlsCaPath: params?.tls?.caCertsPath ?? "",
        attachedDatabases: (params?.attachedDatabases ?? []).map((db: any) => ({
            key: db?.path ?? "",
            value: db?.alias ?? "",
        })),
        gRPCMetadata: Object.entries(metadata).map(([k, v]) => ({ key: k, value: v ?? "" })),
        queryParameters: Object.entries(params?.queryParameters ?? {}).map(([k, v]) => ({ key: k, value: v ?? "" })),
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
    notebookId: string | null;
    onClose?: () => void;
}

export const HyperConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const grpcClient = useHyperGrpcClient();
    const httpClient = useHyperHttpClient();
    const hyperSetup = useHyperSetup();
    const queryExecutor = useQueryExecutor();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER];

    // Wire up the page state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.notebookId);
    const connectionNotebookScripts = useAnyConnectionNotebookScripts(props.notebookId);
    const hyperConnection = getHyperConnectionDetails(connectionState);

    // Seed the form state from the restored connection params so a notebook
    // that was saved across an app restart displays its endpoint/etc.
    // Re-seeds whenever the stored setupParams reference changes (notebook
    // switch, async storage hydration, or an action like RESET that swaps
    // the wrapper state).
    const [pageState, setPageState] = React.useState<HyperConnectionPageState>(() =>
        buildHyperConnectionPageState(hyperConnection?.proto.setupParams));
    const seededParamsRef = React.useRef(hyperConnection?.proto.setupParams);
    React.useEffect(() => {
        const params = hyperConnection?.proto.setupParams;
        if (params !== seededParamsRef.current) {
            seededParamsRef.current = params;
            setPageState(buildHyperConnectionPageState(params));
        }
    }, [hyperConnection]);

    const protocol = pageState.protocol;

    // Docker and direct gRPC both require the native platform
    const wrongPlatform = (protocol === "V3_GRPC" || protocol === "V3_DOCKER") && !isNativePlatform();
    const isDocker = protocol === "V3_DOCKER";
    const protocols: connection.HyperProtocol[] = isNativePlatform()
        ? ["WASM", "V3_DOCKER", "V3_GRPC", "V3_HTTP"]
        : ["WASM", "V3_HTTP"];
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
    }, [hyperConnection?.proto.setupParams, pageState.protocol, pageState.endpoint, pageState.mTlsKeyPath, pageState.mTlsPubPath, pageState.mTlsCaPath]);

    // Docker panel state — lifted so the +/− IconButtons can live in the connection header.
    const [dockerMode, setDockerMode] = React.useState<HyperDockerPanelMode>('list');
    const [dockerEditMode, setDockerEditMode] = React.useState(false);

    // Helper to setup the connection
    const setupParams = React.useMemo<connection.HyperConnectionParams>(() => buildHyperConnectionSetupParams(pageState), [pageState]);
    const setupAbortController = React.useRef<AbortController | null>(null);
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

        // Is there a Hyper client?
        if ((protocol !== 'WASM' && !grpcClient && !httpClient) || hyperSetup == null) {
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
            const hyperChannel = await hyperSetup.setup(dispatchConnectionState, setupParams, setupAbortController.current.signal);
            if (hyperChannel != null && protocol !== 'WASM') {
                await performHealthCheck(queryExecutor, connectionState.connectionId, { type: 'hyper', channel: hyperChannel }, dispatchConnectionState, setupAbortController.current.signal);
            }

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
                setupConnection={isDocker ? undefined : setupConnection}
                cancelSetup={isDocker ? undefined : cancelSetup}
                resetSetup={isDocker ? undefined : resetSetup}
                notebookScripts={connectionNotebookScripts}
                protocol={protocol}
                protocols={protocols}
                onProtocolChange={setProtocol}
                freezeInput={freezeInput}
                embedded={protocol === 'WASM'}
                onClose={props.onClose}
                trailingStatusActions={isDocker && dockerMode === 'list' && (
                    <>
                        <IconButton
                            variant={dockerEditMode ? ButtonVariant.Default : ButtonVariant.Invisible}
                            aria-label={dockerEditMode ? 'Done removing' : 'Remove containers'}
                            aria-pressed={dockerEditMode}
                            onClick={() => setDockerEditMode(v => !v)}
                        >
                            {dockerEditMode ? <CircleSlashIcon /> : <DashIcon />}
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Create container"
                            description="Create a new container"
                            onClick={() => setDockerMode('create')}
                        >
                            <PlusIcon />
                        </IconButton>
                    </>
                )}
            />
            {isDocker ? (
                <div className={style.body_container}>
                    <HyperDockerSettingsPanel
                        notebookId={props.notebookId}
                        freezeInput={freezeInput}
                        mode={dockerMode}
                        setMode={setDockerMode}
                        isEditMode={dockerEditMode}
                        onClose={props.onClose}
                    />
                </div>
            ) : protocol === 'WASM' ? (
                <div className={style.body_container}>
                    <div className={style.section}>
                        <div className={`${style.section_layout} ${style.body_section_layout}`}>
                            <KeyValueListBuilder
                                className={style.grid_column_1_span_2}
                                title="Engine Settings"
                                caption="Settings used to initialize the embedded Hyper engine"
                                keyIcon={() => <div>Name</div>}
                                valueIcon={() => <div>Value</div>}
                                addButtonLabel="Add Setting"
                                elements={HYPERDB_WASM_ENGINE_SETTING_ELEMENTS}
                                modifyElements={() => { }}
                                disabled
                                readOnly
                            />
                        </div>
                    </div>
                </div>
            ) : (
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
                                validation={endpointValidation}
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
                                title="Query Parameters"
                                caption="Connection settings that are added to every query"
                                keyIcon={() => <div>Name</div>}
                                valueIcon={() => <div>Value</div>}
                                addButtonLabel="Add Parameter"
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
