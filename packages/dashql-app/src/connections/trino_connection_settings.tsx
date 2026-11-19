import * as React from 'react';

import * as connection from '@akohn/dashql-jsonschema/connection.js';
import * as auth from '@akohn/dashql-jsonschema/auth.js';

import * as style from './connection_settings.module.css';

import { BookIcon, KeyIcon, PlugIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';

import { Button, ButtonVariant } from '@akohn/dashql-react/components/button';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { Dispatch } from '@akohn/dashql/platform/utils/variant';
import { KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '@akohn/dashql-react/components/keyvalue_list';
import { TextField, VALIDATION_WARNING } from '@akohn/dashql-react/components/text_field';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { useConnectionDraftForm } from './connection_draft.js';
import { useConnection } from '@akohn/dashql-react/hooks';
import { useConnectionSave } from './connection_persistence.js';
import { useConnectionSetup } from './connection_setup.js';
import { useLogger } from '../platform/logger_provider.js';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { UpdateValueList, ValueListBuilder } from '@akohn/dashql-react/components/value_list';
import { ConnectionInlineHeader } from './connection_inline_header.js';
import { SegmentedControl } from '@akohn/dashql-react/components/segmented_control';
import { withTrinoCatalogFields } from '@akohn/dashql/platform/connections/trino_catalogs';

const LOG_CTX = "trino_connector";

interface PageState {
    activeParams: connection.TrinoConnectionParams | null;
    newParams: connection.TrinoConnectionParams;
    newParamsMetadata: KeyValueListElement[];
};

const DEFAULT_TRINO_PARAMS: connection.TrinoConnectionParams = {
    endpoint: "http://localhost:8080",
    auth: {
        authType: "AUTH_BASIC",
        basic: {
            username: "",
            secret: "",
        }
    },
    metadata: {
        message: ""
    },
    defaultCatalog: "",
    defaultSchema: "",
    catalogs: [],
};

export function buildPageStateFromParams(params: connection.TrinoConnectionParams | null | undefined): PageState {
    const active = params ?? null;
    const newParams = params ? withTrinoCatalogFields(params) : DEFAULT_TRINO_PARAMS;
    const metadataData = newParams.metadata ?? {};
    return {
        activeParams: active,
        newParams,
        newParamsMetadata: params?.draftRows?.metadata ?? Object.entries(metadataData).map(([k, v]) => ({ key: k, value: v ?? "" })),
    };
}

interface Props {
    connectionId: string | null;
    onClose?: () => void;
}

export const TrinoConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();

    const connectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];

    // Resolve connection state
    const connectionState = useConnection(props.connectionId);
    const connectionSetup = useConnectionSetup(props.connectionId);
    const { saving } = useConnectionSave(props.connectionId);

    const [pageState, setPageState] = useConnectionDraftForm(props.connectionId,
        params => buildPageStateFromParams(params && 'trino' in params ? params.trino as connection.TrinoConnectionParams : undefined),
        form => ({ trino: { ...form.newParams, draftRows: { metadata: form.newParamsMetadata } } }));

    const endpoint = pageState.newParams?.endpoint;
    const setEndpoint = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            endpoint: v
        },
    }));
    const authType = pageState.newParams?.auth?.authType ?? "AUTH_BASIC";
    const setAuthType = (t: auth.AuthType) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: t,
            },
        },
    }));
    const basicAuthUsername = pageState.newParams?.auth?.basic?.username;
    const setBasicAuthUsername: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_BASIC",
                basic: {
                    username: v,
                    secret: s.newParams.auth?.basic?.secret ?? "",
                },
            },
        }
    }));
    const basicAuthSecret = pageState.newParams?.auth?.basic?.secret;
    const setBasicAuthSecret: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_BASIC",
                basic: {
                    username: s.newParams?.auth?.basic?.username ?? "",
                    secret: v,
                },
            },
        }
    }));
    const oauthAuthEndpoint = pageState.newParams.auth?.oauth?.authorizationUrl;
    const setOAuthAuthEndpoint: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_OAUTH",
                oauth: {
                    authorizationUrl: v,
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl ?? "",
                    clientId: s.newParams?.auth?.oauth?.clientId ?? "",
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl ?? "",
                    scopes: s.newParams?.auth?.oauth?.scopes ?? [],
                },
            },
        }
    }));

    const oauthTokenEndpoint = pageState.newParams.auth?.oauth?.tokenUrl;
    const setOAuthTokenEndpoint: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_OAUTH",
                oauth: {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl ?? "",
                    tokenUrl: v,
                    clientId: s.newParams?.auth?.oauth?.clientId ?? "",
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl ?? "",
                    scopes: s.newParams?.auth?.oauth?.scopes ?? [],
                },
            },
        }
    }));

    const oauthClientId = pageState.newParams.auth?.oauth?.clientId;
    const setOAuthClientId: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_OAUTH",
                oauth: {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl ?? "",
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl ?? "",
                    clientId: v,
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl ?? "",
                    scopes: s.newParams?.auth?.oauth?.scopes ?? [],
                },
            },
        }
    }));

    const oauthRedirectUrl = pageState.newParams.auth?.oauth?.callbackUrl;
    const setOAuthRedirectUrl: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_OAUTH",
                oauth: {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl ?? "",
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl ?? "",
                    clientId: s.newParams?.auth?.oauth?.clientId ?? "",
                    callbackUrl: v,
                    scopes: s.newParams?.auth?.oauth?.scopes ?? [],
                },
            },
        }
    }));

    const oauthScopes = pageState.newParams.auth?.oauth?.scopes ?? [];
    const modifyOAuthScopes: Dispatch<UpdateValueList> = (action: UpdateValueList) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            auth: {
                authType: "AUTH_OAUTH",
                oauth: {
                    authorizationUrl: s.newParams?.auth?.oauth?.authorizationUrl ?? "",
                    tokenUrl: s.newParams?.auth?.oauth?.tokenUrl ?? "",
                    clientId: s.newParams?.auth?.oauth?.clientId ?? "",
                    callbackUrl: s.newParams?.auth?.oauth?.callbackUrl ?? "",
                    scopes: action(s.newParams?.auth?.oauth?.scopes ?? []),
                },
            },
        }
    }));


    const defaultCatalog = pageState.newParams.defaultCatalog ?? "";
    const setDefaultCatalog: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            defaultCatalog: v
        }
    }));
    const defaultSchema = pageState.newParams.defaultSchema ?? "";
    const setDefaultSchema: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            defaultSchema: v
        }
    }));
    const catalogs = pageState.newParams.catalogs ?? [];
    const modifyCatalogs: Dispatch<UpdateValueList> = (action: UpdateValueList) => setPageState(s => ({
        ...s,
        newParams: {
            ...s.newParams,
            catalogs: action(s.newParams.catalogs ?? [])
        }
    }));
    const modifyMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => {
        const metadata = action(s.newParamsMetadata);

        // Flatten the key-value list eagerly for the new params.
        // We could decide to do this lazily but it shouldn't really matter.
        const metadataObj: Record<string, string> = {};
        for (const entry of metadata) {
            metadataObj[entry.key] = entry.value;
        }
        return {
            ...s,
            newParamsMetadata: metadata,
            newParams: {
                ...s.newParams,
                metadata: metadataObj
            }
        };
    });

    // The runtime sets up the connection and checks its health, the view of the connection shows a failure
    const setupConnection = async () => {
        if (connectionState == null) {
            logger.warn("Trino connection state is null", {}, LOG_CTX);
            return;
        }
        await connectionSetup.run({ trino: pageState.newParams });
    };
    const cancelSetup = connectionSetup.cancel;
    const resetSetup = connectionSetup.reset;

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    // Saving writes the settings into every workbook that uses the connection
    let freezeInput = saving;
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
            break;
    }

    return (
        <div className={style.layout}>
            <ConnectionInlineHeader
                connector={connectorInfo}
                connection={connectionState}
                wrongPlatform={false}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                onClose={props.onClose}
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
                            <SegmentedControl
                                aria-label="Authentication type"
                                onChange={(index) => {
                                    const newAuthType = index === 0
                                        ? "AUTH_BASIC"
                                        : "AUTH_OAUTH";
                                    // The control also reports a click on the selected type, which must keep the credentials
                                    if (newAuthType !== authType) {
                                        setAuthType(newAuthType);
                                    }
                                }}
                            >
                                <SegmentedControl.Button
                                    selected={authType === "AUTH_BASIC"}
                                    disabled={freezeInput}
                                >
                                    Basic
                                </SegmentedControl.Button>
                                <SegmentedControl.Button
                                    selected={authType === "AUTH_OAUTH"}
                                    disabled={freezeInput}
                                >
                                    OAuth 2.0
                                </SegmentedControl.Button>
                            </SegmentedControl>
                        </div>
                        <TextField
                            style={{ display: authType == "AUTH_BASIC" ? 'block' : 'none' }}
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
                            style={{ display: authType == "AUTH_BASIC" ? 'block' : 'none' }}
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
                            style={{ display: authType == "AUTH_OAUTH" ? 'block' : 'none' }}
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
                            style={{ display: authType == "AUTH_OAUTH" ? 'block' : 'none' }}
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
                            style={{ display: authType == "AUTH_OAUTH" ? 'block' : 'none' }}
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
                            style={{ display: authType == "AUTH_OAUTH" ? 'block' : 'none' }}
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
                        <ValueListBuilder
                            title="Catalogs"
                            caption="Relations to load, 'catalog' for all schemas or 'catalog.schema' for one. Without entries the default catalog is loaded."
                            valueIcon={BookIcon}
                            addButtonLabel="Add Catalog"
                            elements={catalogs}
                            modifyElements={modifyCatalogs}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Default Catalog"
                            caption="Catalog of the names that statements leave out"
                            value={defaultCatalog}
                            placeholder=""
                            leadingVisual={BookIcon}
                            onChange={(e) => setDefaultCatalog(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Default Schema"
                            caption="Schema of the names that statements leave out"
                            value={defaultSchema}
                            placeholder=""
                            validation={
                                defaultSchema.trim().length > 0 && defaultCatalog.trim().length == 0
                                    ? { type: VALIDATION_WARNING, value: "A default schema needs a default catalog" }
                                    : undefined
                            }
                            leadingVisual={BookIcon}
                            onChange={(e) => setDefaultSchema(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
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
