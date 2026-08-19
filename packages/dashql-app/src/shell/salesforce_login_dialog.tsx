import * as React from 'react';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { Overlay, OverlaySize } from '../ui/foundations/overlay.js';
import { useFocusTrap } from '../ui/foundations/focus.js';
import { TextFieldValidationStatus, VALIDATION_ERROR, VALIDATION_UNKNOWN } from '../ui/foundations/text_field.js';
import { IndicatorStatus } from '../ui/foundations/status_indicator.js';
import { ConnectionHealth } from '../app/notebook/connections/connection_state.js';
import { SalesforceConnectionSettingsPage } from '../app/notebook/connections/ui/salesforce_connection_settings.js';
import { collectSalesforceAuthInfo } from '../app/notebook/connections/salesforce/salesforce_api_client.js';
import * as styles from './salesforce_login_dialog.module.css';

export interface SalesforceLoginFormValues {
    alias: string;
    instanceUrl: string;
    appConsumerKey: string;
    loginHint: string;
    oauthPopup?: Window | null;
    abortSignal?: AbortSignal;
}

export interface SalesforceLoginDialogController {
    request: (signal?: AbortSignal) => Promise<SalesforceLoginFormValues | null>;
    update: (progress: SalesforceLoginDialogProgress) => void;
    succeed: (message: string) => void;
    fail: (message: string) => void;
}

export interface SalesforceLoginDialogProgress {
    status?: string;
    coreAccessToken?: connection.SalesforceCoreAccessToken;
    dataCloudAccessToken?: connection.SalesforceDataCloudAccessToken;
    login?: string;
}

export interface SalesforceLoginDialogHookResult {
    controller: SalesforceLoginDialogController;
    dialog: React.ReactElement | null;
}

export interface SalesforceLoginDialogOptions {
    openOAuthPopup?: () => Window | null;
    hasAlias?: (alias: string) => boolean;
}

interface PendingRequest {
    resolve: (values: SalesforceLoginFormValues | null) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
    abortController: AbortController;
    submitted: boolean;
}

interface DialogState extends SalesforceLoginDialogProgress {
    phase: 'form' | 'running' | 'succeeded' | 'failed';
    status: string;
    indicator: IndicatorStatus;
    statusError?: string;
}

const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function defaultOpenOAuthPopup(): Window | null {
    return window.open('', 'DashQL OAuth', 'popup=yes,width=720,height=760');
}

export function useSalesforceLoginDialog(
    options: SalesforceLoginDialogOptions = {},
): SalesforceLoginDialogHookResult {
    const [isOpen, setIsOpen] = React.useState(false);
    const [dialogState, setDialogState] = React.useState<DialogState>({
        phase: 'form',
        status: 'Disconnected',
        indicator: IndicatorStatus.None,
    });
    const pendingRequestRef = React.useRef<PendingRequest | null>(null);
    const openOAuthPopup = options.openOAuthPopup ?? defaultOpenOAuthPopup;

    const dismiss = React.useCallback(() => {
        const pending = pendingRequestRef.current;
        if (pending != null) {
            pending.abortController.abort();
            pendingRequestRef.current = null;
            if (pending.signal != null && pending.onAbort != null) {
                pending.signal.removeEventListener('abort', pending.onAbort);
            }
            if (!pending.submitted) pending.resolve(null);
        }
        setIsOpen(false);
    }, []);

    const submit = React.useCallback((values: SalesforceLoginFormValues) => {
        const pending = pendingRequestRef.current;
        if (pending == null || pending.submitted) return;
        pending.submitted = true;
        setDialogState({
            phase: 'running',
            status: 'Starting authorization',
            indicator: IndicatorStatus.Running,
            login: values.loginHint,
        });
        pending.resolve(values);
    }, []);

    const request = React.useCallback((signal?: AbortSignal) => {
        const existing = pendingRequestRef.current;
        if (existing != null && !existing.submitted) {
            return Promise.reject(new Error('A Salesforce login request is already pending.'));
        }
        if (signal?.aborted) {
            dismiss();
            return Promise.resolve(null);
        }

        if (existing != null) {
            existing.submitted = false;
            return new Promise<SalesforceLoginFormValues | null>(resolve => {
                existing.resolve = resolve;
            });
        }

        setDialogState({ phase: 'form', status: 'Disconnected', indicator: IndicatorStatus.None });
        setIsOpen(true);
        return new Promise<SalesforceLoginFormValues | null>(resolve => {
            const pending: PendingRequest = {
                resolve,
                signal,
                abortController: new AbortController(),
                submitted: false,
            };
            pending.onAbort = dismiss;
            pendingRequestRef.current = pending;
            signal?.addEventListener('abort', pending.onAbort, { once: true });
        });
    }, [dismiss]);

    React.useEffect(() => () => {
        const pending = pendingRequestRef.current;
        if (pending == null) return;
        pending.abortController.abort();
        pendingRequestRef.current = null;
        if (pending.signal != null && pending.onAbort != null) {
            pending.signal.removeEventListener('abort', pending.onAbort);
        }
        if (!pending.submitted) pending.resolve(null);
    }, []);

    const update = React.useCallback((progress: SalesforceLoginDialogProgress) => {
        setDialogState(state => ({
            ...state,
            ...progress,
            phase: state.phase === 'form' ? 'running' : state.phase,
            indicator: IndicatorStatus.Running,
        }));
    }, []);
    const succeed = React.useCallback((message: string) => {
        const pending = pendingRequestRef.current;
        pendingRequestRef.current = null;
        if (pending?.signal != null && pending.onAbort != null) {
            pending.signal.removeEventListener('abort', pending.onAbort);
        }
        setDialogState(state => ({
            ...state,
            phase: 'succeeded',
            status: message,
            indicator: IndicatorStatus.Succeeded,
        }));
        setIsOpen(false);
    }, []);
    const fail = React.useCallback((message: string) => {
        setDialogState(state => ({
            ...state,
            phase: 'failed',
            status: 'Connection failed',
            statusError: message,
            indicator: IndicatorStatus.Failed,
        }));
    }, []);
    const controller = React.useMemo<SalesforceLoginDialogController>(
        () => ({ request, update, succeed, fail }),
        [fail, request, succeed, update],
    );
    return {
        controller,
        dialog: isOpen ? (
            <SalesforceLoginDialog
                openOAuthPopup={openOAuthPopup}
                state={dialogState}
                abortSignal={pendingRequestRef.current?.abortController.signal}
                hasAlias={options.hasAlias}
                onCancel={dismiss}
                onSubmit={submit}
            />
        ) : null,
    };
}

interface SalesforceLoginDialogProps {
    openOAuthPopup: () => Window | null;
    state: DialogState;
    abortSignal?: AbortSignal;
    hasAlias?: (alias: string) => boolean;
    onCancel: () => void;
    onSubmit: (values: SalesforceLoginFormValues) => void;
}

function SalesforceLoginDialog(props: SalesforceLoginDialogProps) {
    const dialogRef = React.useRef<HTMLElement>(null);
    const [alias, setAlias] = React.useState('d360');
    const [instanceUrl, setInstanceUrl] = React.useState('');
    const [appConsumerKey, setAppConsumerKey] = React.useState('');
    const [aliasValidation, setAliasValidation] = React.useState<TextFieldValidationStatus>({ type: VALIDATION_UNKNOWN, value: null });
    const [instanceUrlValidation, setInstanceUrlValidation] = React.useState<TextFieldValidationStatus>({ type: VALIDATION_UNKNOWN, value: null });
    const [appConsumerValidation, setAppConsumerValidation] = React.useState<TextFieldValidationStatus>({ type: VALIDATION_UNKNOWN, value: null });
    const isRunning = props.state.phase === 'running';
    const freezeInput = isRunning || props.state.phase === 'succeeded';
    const authentication = props.state.coreAccessToken && props.state.dataCloudAccessToken
        ? collectSalesforceAuthInfo(props.state.coreAccessToken, props.state.dataCloudAccessToken)
        : null;
    const connectionHealth = props.state.phase === 'running'
        ? ConnectionHealth.CONNECTING
        : props.state.phase === 'succeeded'
            ? ConnectionHealth.ONLINE
            : props.state.phase === 'failed'
                ? ConnectionHealth.FAILED
                : ConnectionHealth.NOT_STARTED;

    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    const setupConnection = () => {
        const trimmedAlias = alias.trim();
        const trimmedInstanceUrl = instanceUrl.trim();
        const trimmedConsumerKey = appConsumerKey.trim();
        let valid = true;

        if (!trimmedAlias) {
            valid = false;
            setAliasValidation({ type: VALIDATION_ERROR, value: 'Alias cannot be empty' });
        } else if (!ALIAS_PATTERN.test(trimmedAlias)) {
            valid = false;
            setAliasValidation({ type: VALIDATION_ERROR, value: 'Use letters, numbers, and underscores, starting with a letter or underscore' });
        } else if (props.hasAlias?.(trimmedAlias)) {
            valid = false;
            setAliasValidation({ type: VALIDATION_ERROR, value: `Salesforce alias already exists: ${trimmedAlias}` });
        } else {
            setAliasValidation({ type: VALIDATION_UNKNOWN, value: null });
        }
        if (!trimmedInstanceUrl) {
            valid = false;
            setInstanceUrlValidation({ type: VALIDATION_ERROR, value: 'Instance URL cannot be empty' });
        } else {
            setInstanceUrlValidation({ type: VALIDATION_UNKNOWN, value: null });
        }
        if (!trimmedConsumerKey) {
            valid = false;
            setAppConsumerValidation({ type: VALIDATION_ERROR, value: 'Connected App cannot be empty' });
        } else {
            setAppConsumerValidation({ type: VALIDATION_UNKNOWN, value: null });
        }
        if (!valid) return;

        const oauthPopup = props.openOAuthPopup();
        if (!oauthPopup) {
            setAppConsumerValidation({ type: VALIDATION_ERROR, value: 'OAuth window was blocked. Allow popups for this site, then try again' });
            return;
        }
        setAlias(trimmedAlias);
        setInstanceUrl(trimmedInstanceUrl);
        setAppConsumerKey(trimmedConsumerKey);
        props.onSubmit({
            alias: trimmedAlias,
            instanceUrl: trimmedInstanceUrl,
            appConsumerKey: trimmedConsumerKey,
            loginHint: '',
            oauthPopup,
            abortSignal: props.abortSignal,
        });
    };

    return (
        <Overlay
            centered
            minWidth={OverlaySize.L}
            maxWidth={OverlaySize.XXL}
            height={OverlaySize.AUTO}
            maxHeight={OverlaySize.XL}
            onEscape={props.onCancel}
            onClickOutside={props.onCancel}
        >
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-label="Salesforce Data Cloud connection"
                onKeyDown={event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onCancel();
                }}
            >
                <SalesforceConnectionSettingsPage
                    connectionState={null}
                    notebookScripts={null}
                    hyperProtocol="V3_HTTP"
                    protocols={[]}
                    wrongPlatform={false}
                    freezeInput={freezeInput}
                    instanceUrl={instanceUrl}
                    appConsumerKey={appConsumerKey}
                    login={props.state.login ?? ''}
                    coreAccessToken={authentication?.coreAccessToken ?? ''}
                    dataCloudInstanceUrl={authentication?.offcoreInstanceUrl ?? ''}
                    dataCloudAccessToken={authentication?.offcoreRawJwt ?? ''}
                    coreTenantId={authentication?.coreTenantId ?? ''}
                    dataCloudTenantId={authentication?.offcoreTenantId ?? ''}
                    instanceUrlValidation={instanceUrlValidation}
                    appConsumerValidation={appConsumerValidation}
                    setHyperProtocol={() => {}}
                    updateInstanceUrl={event => setInstanceUrl(event.target.value)}
                    updateAppConsumerKey={event => setAppConsumerKey(event.target.value)}
                    setupConnection={setupConnection}
                    cancelSetup={props.onCancel}
                    resetSetup={props.onCancel}
                    onClose={props.onCancel}
                    alias={{
                        value: alias,
                        onChange: event => setAlias(event.target.value),
                        validation: aliasValidation,
                    }}
                    statusText={props.state.status}
                    indicatorStatus={props.state.indicator}
                    statusError={props.state.statusError}
                    connectionHealth={connectionHealth}
                />
            </section>
        </Overlay>
    );
}
