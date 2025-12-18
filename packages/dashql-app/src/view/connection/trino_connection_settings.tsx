import * as React from 'react';
import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf'

import * as style from './connection_settings.module.css';

import {
    BookIcon,
    KeyIcon,
    PlugIcon,
    XIcon,
} from '@primer/octicons-react';

import { Button, ButtonVariant } from '../foundations/button.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { Dispatch } from '../../utils/variant.js';
import { KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '../foundations/keyvalue_list.js';
import { TextField, VALIDATION_WARNING } from '../foundations/text_field.js';
import { classNames } from '../../utils/classnames.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useTrinoSetup } from '../../connection/trino/trino_connector.js';
import { CONNECTOR_INFOS, ConnectorType, requiresSwitchingToNative, TRINO_CONNECTOR } from '../../connection/connector_info.js';
import { UpdateValueList, ValueListBuilder } from '../../view/foundations/value_list.js';
import { useAnyConnectionWorkbook } from './connection_workbook.js';
import { ConnectionHeader } from './connection_settings_header.js';
import { AuthTypeDropdown } from './auth_type_dropdown.js';
import { LoggableException } from '../../platform/logger.js';

const LOG_CTX = "trino_connector";

interface PageState {
    activeParams: pb.dashql.connection.TrinoConnectionParams | null;
    newParams: pb.dashql.connection.TrinoConnectionParams;
    newParamsMetadata: KeyValueListElement[];
};
type PageStateSetter = Dispatch<React.SetStateAction<PageState>>;
const PAGE_STATE_CTX = React.createContext<[PageState, PageStateSetter] | null>(null);

interface Props {
    connectionId: number;
}

export const TrinoConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const trinoSetup = useTrinoSetup();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);

    // Resolve connection state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.connectionId);
    const connectionWorkbook = useAnyConnectionWorkbook(props.connectionId);
    const [pageState, setPageState] = React.useContext(PAGE_STATE_CTX)!;

    const endpoint = pageState.newParams?.endpoint;
    const setEndpoint = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            endpoint: v
        }),
    }));
    const authType = pageState.newParams?.auth?.authType ?? pb.dashql.auth.AuthType.AUTH_BASIC;
    const setAuthType = (t: pb.dashql.auth.AuthType) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: t,
            }),
        }),
    }));
    const basicAuthUsername = pageState.newParams?.auth?.basic?.username;
    const setBasicAuthUsername: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_BASIC,
                basic: buf.create(pb.dashql.auth.BasicAuthParamsSchema, {
                    username: v,
                    secret: s.newParams.auth?.basic?.secret,
                }),
            }),
        })
    }));
    const basicAuthSecret = pageState.newParams?.auth?.basic?.secret;
    const setBasicAuthSecret: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_BASIC,
                basic: buf.create(pb.dashql.auth.BasicAuthParamsSchema, {
                    username: s.newParams?.auth?.basic?.username,
                    secret: v,
                }),
            }),
        })
    }));
    const oauthAuthEndpoint = pageState.newParams.auth?.oauth?.authorizationUrl;
    const setOAuthAuthEndpoint: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_OAUTH,
                oauth: buf.create(pb.dashql.auth.OAuthParamsSchema, {
                    authorizationUrl: v,
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl,
                    clientId: s.newParams?.auth?.oauth?.clientId,
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl,
                    scopes: s.newParams?.auth?.oauth?.scopes,
                }),
            }),
        })
    }));

    const oauthTokenEndpoint = pageState.newParams.auth?.oauth?.tokenUrl;
    const setOAuthTokenEndpoint: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_OAUTH,
                oauth: buf.create(pb.dashql.auth.OAuthParamsSchema, {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl,
                    tokenUrl: v,
                    clientId: s.newParams?.auth?.oauth?.clientId,
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl,
                    scopes: s.newParams?.auth?.oauth?.scopes,
                }),
            }),
        })
    }));

    const oauthClientId = pageState.newParams.auth?.oauth?.clientId;
    const setOAuthClientId: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_OAUTH,
                oauth: buf.create(pb.dashql.auth.OAuthParamsSchema, {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl,
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl,
                    clientId: v,
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl,
                    scopes: s.newParams?.auth?.oauth?.scopes,
                }),
            }),
        })
    }));

    const oauthRedirectUrl = pageState.newParams.auth?.oauth?.callbackUrl;
    const setOAuthRedirectUrl: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_OAUTH,
                oauth: buf.create(pb.dashql.auth.OAuthParamsSchema, {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl,
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl,
                    clientId: s.newParams?.auth?.oauth?.clientId,
                    callbackUrl: v,
                    scopes: s.newParams?.auth?.oauth?.scopes,
                }),
            }),
        })
    }));

    const oauthScopes = pageState.newParams.auth?.oauth?.scopes ?? [];
    const modifyOAuthScopes: Dispatch<UpdateValueList> = (action: UpdateValueList) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_OAUTH,
                oauth: buf.create(pb.dashql.auth.OAuthParamsSchema, {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl,
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl,
                    clientId: s.newParams?.auth?.oauth?.clientId,
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl,
                    scopes: action(s.newParams?.auth?.oauth?.scopes ?? []),
                }),
            }),
        })
    }));


    const setCatalogName: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            catalogName: v
        })
    }));
    const modifySchemaNames: Dispatch<UpdateValueList> = (action: UpdateValueList) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            schemaNames: action(s.newParams.schemaNames)
        })
    }));
    const modifyMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => {
        const metadata = action(s.newParamsMetadata);

        // Flatten the key-value list eagerly for the new params.
        // We could decide to do this lazily but it shouldn't really matter.
        const metadataObj: { [key: string]: string } = {};
        for (const entry of metadata) {
            metadataObj[entry.key] = entry.value;
        }
        return {
            ...s,
            newParamsMetadata: metadata,
            newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
                ...s.newParams,
                metadata: metadataObj
            })
        };
    });

    // Update the page state with the connection params
    React.useEffect(() => {
        if (connectionState?.details.type != TRINO_CONNECTOR) {
            return;
        }
        // Did the channel params change?
        // Then we reset the params of the settings page
        const activeParams = connectionState.details.value.proto.setupParams;
        if (activeParams != null && activeParams !== pageState.activeParams) {
            setPageState({
                activeParams: activeParams,
                newParamsMetadata: Object.entries(activeParams.metadata).map(([k, v]) => ({ key: k, value: v })) as KeyValueListElement[],
                newParams: activeParams
            });
        }
    }, [connectionState?.details]);

    // Helper to setup the connection
    const setupAbortController = React.useRef<AbortController | null>(null);
    const setupConnection = async () => {
        // Is there a Trino client?
        if (trinoSetup == null) {
            logger.error("Trino connector is unavailable", {}, LOG_CTX);
            return;
        }
        // Is there a connection id?
        if (connectionState == null) {
            logger.warn("Trino connection state is null", {}, LOG_CTX);
            return;
        }

        try {
            // Setup the Trino connection
            setupAbortController.current = new AbortController();
            const connectionParams: pb.dashql.connection.TrinoConnectionParams = pageState.newParams;
            await trinoSetup.setup(dispatchConnectionState, connectionParams, setupAbortController.current.signal);

        } catch (error: any) {
            if (error instanceof LoggableException) {
                logger.exception(error);
            } else {
                logger.error("Error while setting up trino connection", {
                    authType: (pageState.newParams.auth?.authType ?? 0).toString(),
                    error: error.toString(),
                }, LOG_CTX);
            }
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
        if (trinoSetup) {
            await trinoSetup.reset(dispatchConnectionState);
        }
    };

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    let freezeInput = false;
    switch (connectionState?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.FAILED:
            connectButton = <Button variant={ButtonVariant.Primary} leadingVisual={PlugIcon} onClick={setupConnection}>Connect</Button>;
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
            <ConnectionHeader
                connector={connectorInfo}
                connection={connectionState}
                wrongPlatform={wrongPlatform}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                workbook={connectionWorkbook}
            />
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Endpoint"
                            caption="Endpoint of the Trino Api as 'https://host:port'"
                            value={endpoint}
                            placeholder=""
                            validation={
                                (endpoint.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Endpoint is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>URL</div>}
                            onChange={(e) => setEndpoint(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <div className={style.section_header}>
                            <AuthTypeDropdown selected={authType} onSelect={setAuthType} />
                        </div>
                        <TextField
                            style={{ display: authType == pb.dashql.auth.AuthType.AUTH_BASIC ? 'block' : 'none' }}
                            name="Username"
                            caption="Username for the Trino Api"
                            placeholder=""
                            validation={
                                (basicAuthUsername?.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Username is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>ID</div>}
                            value={basicAuthUsername ?? ""}
                            onChange={(e) => setBasicAuthUsername(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            style={{ display: authType == pb.dashql.auth.AuthType.AUTH_BASIC ? 'block' : 'none' }}
                            name="Secret"
                            caption="Password for the Trino Api"
                            placeholder=""
                            validation={
                                (basicAuthSecret?.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Secret is empty" }
                                    : undefined
                            }
                            leadingVisual={KeyIcon}
                            value={basicAuthSecret ?? ""}
                            onChange={(e) => setBasicAuthSecret(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            concealed={true}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            style={{ display: authType == pb.dashql.auth.AuthType.AUTH_OAUTH ? 'block' : 'none' }}
                            name="Authorization Url"
                            caption="Url to start the OAuth flow"
                            placeholder=""
                            validation={
                                (pageState.newParams.auth?.oauth?.authorizationUrl.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Authorization Url is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>URL</div>}
                            value={oauthAuthEndpoint ?? ""}
                            onChange={(e) => setOAuthAuthEndpoint(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            style={{ display: authType == pb.dashql.auth.AuthType.AUTH_OAUTH ? 'block' : 'none' }}
                            name="Token Url"
                            caption="Url to retrieve an Access Token"
                            placeholder=""
                            validation={
                                (pageState.newParams.auth?.oauth?.tokenUrl.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Token Endpoint is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>URL</div>}
                            value={oauthTokenEndpoint ?? ""}
                            onChange={(e) => setOAuthTokenEndpoint(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            style={{ display: authType == pb.dashql.auth.AuthType.AUTH_OAUTH ? 'block' : 'none' }}
                            name="Client ID"
                            caption="Client ID of the OAuth application"
                            placeholder=""
                            validation={
                                (pageState.newParams.auth?.oauth?.clientId?.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Client ID is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>ID</div>}
                            value={oauthClientId ?? ""}
                            onChange={(e) => setOAuthClientId(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            style={{ display: authType == pb.dashql.auth.AuthType.AUTH_OAUTH ? 'block' : 'none' }}
                            name="Redirect URL"
                            caption="Redirect URL of the OAuth application"
                            placeholder=""
                            validation={
                                (pageState.newParams.auth?.oauth?.callbackUrl?.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Redirect URL is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>URL</div>}
                            value={oauthRedirectUrl ?? ""}
                            onChange={(e) => setOAuthRedirectUrl(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <ValueListBuilder
                            title="Scope"
                            caption="OAuth scopes"
                            valueIcon={() => <div>Scope</div>}
                            addButtonLabel="Add Scope"
                            elements={oauthScopes}
                            modifyElements={modifyOAuthScopes}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Catalog"
                            caption="Name of the Trino Catalog"
                            value={pageState.newParams.catalogName}
                            placeholder=""
                            validation={
                                (pageState.newParams.catalogName.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Catalog is empty" }
                                    : undefined
                            }
                            leadingVisual={BookIcon}
                            onChange={(e) => setCatalogName(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <ValueListBuilder
                            title="Schemas"
                            caption="Names of the Trino Schemas"
                            valueIcon={() => <div>Value</div>}
                            addButtonLabel="Add Value"
                            elements={pageState.newParams.schemaNames}
                            modifyElements={modifySchemaNames}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <KeyValueListBuilder
                            title="Additional Metadata"
                            caption="Extra HTTP headers that are added to each request"
                            keyIcon={() => <div>Header</div>}
                            valueIcon={() => <div>Value</div>}
                            addButtonLabel="Add Header"
                            elements={pageState.newParamsMetadata}
                            modifyElements={modifyMetadata}
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

export const TrinoConnectorSettingsStateProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const state = React.useState<PageState>({
        activeParams: null,
        newParamsMetadata: [],
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            endpoint: "http://localhost:8080",
            auth: buf.create(pb.dashql.auth.TrinoAuthParamsSchema, {
                authType: pb.dashql.auth.AuthType.AUTH_BASIC,
                basic: buf.create(pb.dashql.auth.BasicAuthParamsSchema, {
                    username: "",
                    secret: "",
                })
            }),
            metadata: {},
            catalogName: "",
            schemaNames: [],
        })
    });
    return (
        <PAGE_STATE_CTX.Provider value={state}>
            {props.children}
        </PAGE_STATE_CTX.Provider>
    );
};
