import * as React from 'react';
import * as connection from '@akohn/dashql-jsonschema/connection.js';

import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import { useFocusTrap } from '@akohn/dashql-react/dom/focus';
import { TextFieldValidationStatus, VALIDATION_ERROR, VALIDATION_UNKNOWN } from '@akohn/dashql-react/components/text_field';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { SalesforceConnectionSettingsPage } from '../../connections/salesforce_connection_settings.js';
import { collectSalesforceAuthInfo } from '@akohn/dashql/platform/connections/salesforce/salesforce_api_client';
import type { SalesforceLoginHistoryEntry } from './salesforce_login_history.js';
import { usePendingRequest } from '../../utils/use_pending_request.js';
import * as styles from './salesforce_login_dialog.module.css';

import symbols from '@akohn/dashql-svg-symbols';
import { HistoryIcon, TrashIcon } from '@akohn/dashql-react/components/symbol_icon';

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
    nativeOAuth?: boolean;
    loadHistory?: () => Promise<SalesforceLoginHistoryEntry[]>;
    deleteHistoryEntry?: (organizationId: string) => Promise<SalesforceLoginHistoryEntry[]>;
}

/// The login of the open dialog, closing the dialog or aborting the command that opened it cancels it
interface DialogLogin {
    abort: AbortController;
    detach: () => void;
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
    // The form waits for a submit, a failed login asks for it again while the dialog stays open
    const { dismiss: dismissForm, request: requestForm, resolve: resolveForm } =
        usePendingRequest<void, SalesforceLoginFormValues | null>('Salesforce login', null);
    const loginRef = React.useRef<DialogLogin | null>(null);
    const openOAuthPopup = options.openOAuthPopup ?? defaultOpenOAuthPopup;

    /// Close the dialog, `cancel` aborts its login
    const close = React.useCallback((cancel: boolean) => {
        const login = loginRef.current;
        loginRef.current = null;
        login?.detach();
        if (cancel) login?.abort.abort();
        dismissForm();
        setIsOpen(false);
    }, [dismissForm]);
    const dismiss = React.useCallback(() => close(true), [close]);

    const submit = React.useCallback((values: SalesforceLoginFormValues) => {
        if (!resolveForm(values)) return;
        setDialogState({
            phase: 'running',
            status: 'Starting authorization',
            indicator: IndicatorStatus.Running,
            login: values.loginHint,
        });
    }, [resolveForm]);

    const request = React.useCallback((signal?: AbortSignal) => {
        if (signal?.aborted) {
            dismiss();
            return Promise.resolve(null);
        }
        if (loginRef.current == null) {
            signal?.addEventListener('abort', dismiss, { once: true });
            loginRef.current = {
                abort: new AbortController(),
                detach: () => signal?.removeEventListener('abort', dismiss),
            };
            setDialogState({ phase: 'form', status: 'Disconnected', indicator: IndicatorStatus.None });
            setIsOpen(true);
        }
        return requestForm();
    }, [dismiss, requestForm]);

    React.useEffect(() => () => close(true), [close]);

    const update = React.useCallback((progress: SalesforceLoginDialogProgress) => {
        setDialogState(state => ({
            ...state,
            ...progress,
            phase: state.phase === 'form' ? 'running' : state.phase,
            indicator: IndicatorStatus.Running,
        }));
    }, []);
    const succeed = React.useCallback((message: string) => {
        setDialogState(state => ({
            ...state,
            phase: 'succeeded',
            status: message,
            indicator: IndicatorStatus.Succeeded,
        }));
        close(false);
    }, [close]);
    const fail = React.useCallback((message: string) => {
        setDialogState(state => ({
            ...state,
            phase: 'failed',
            status: 'Salesforce authentication failed',
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
                nativeOAuth={options.nativeOAuth ?? false}
                state={dialogState}
                abortSignal={loginRef.current?.abort.signal}
                loadHistory={options.loadHistory}
                deleteHistoryEntry={options.deleteHistoryEntry}
                onCancel={dismiss}
                onSubmit={submit}
            />
        ) : null,
    };
}

interface SalesforceLoginDialogProps {
    openOAuthPopup: () => Window | null;
    nativeOAuth: boolean;
    state: DialogState;
    abortSignal?: AbortSignal;
    loadHistory?: () => Promise<SalesforceLoginHistoryEntry[]>;
    deleteHistoryEntry?: (organizationId: string) => Promise<SalesforceLoginHistoryEntry[]>;
    onCancel: () => void;
    onSubmit: (values: SalesforceLoginFormValues) => void;
}

function SalesforceLoginDialog(props: SalesforceLoginDialogProps) {
    const dialogRef = React.useRef<HTMLElement>(null);
    const aliasInputRef = React.useRef<HTMLInputElement>(null);
    const [alias, setAlias] = React.useState('d360');
    const [instanceUrl, setInstanceUrl] = React.useState('');
    const [appConsumerKey, setAppConsumerKey] = React.useState('');
    const [loginHint, setLoginHint] = React.useState('');
    const [historyOpen, setHistoryOpen] = React.useState(false);
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
        initialFocusRef: aliasInputRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
        disabled: historyOpen,
    });

    React.useLayoutEffect(() => {
        aliasInputRef.current?.focus();
    }, []);

    const selectHistoryEntry = React.useCallback((entry: SalesforceLoginHistoryEntry) => {
        setAlias(entry.name);
        setInstanceUrl(entry.instanceUrl);
        setAppConsumerKey(entry.appConsumerKey);
        setLoginHint(entry.loginHint ?? '');
        setAliasValidation({ type: VALIDATION_UNKNOWN, value: null });
        setInstanceUrlValidation({ type: VALIDATION_UNKNOWN, value: null });
        setAppConsumerValidation({ type: VALIDATION_UNKNOWN, value: null });
        setHistoryOpen(false);
    }, []);

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

        const oauthPopup = props.nativeOAuth ? undefined : props.openOAuthPopup();
        if (!props.nativeOAuth && !oauthPopup) {
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
            loginHint,
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
            preventFocusOnOpen
            onEscape={() => historyOpen ? setHistoryOpen(false) : props.onCancel()}
            onClickOutside={props.onCancel}
        >
            <section
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-label="Salesforce login"
                data-testid="salesforce-login-dialog"
                onKeyDown={event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (historyOpen) setHistoryOpen(false);
                    else props.onCancel();
                }}
            >
                <SalesforceConnectionSettingsPage
                    connectionState={null}
                    wrongPlatform={false}
                    freezeInput={freezeInput}
                    instanceUrl={instanceUrl}
                    appConsumerKey={appConsumerKey}
                    login={props.state.login ?? loginHint}
                    coreAccessToken={props.state.coreAccessToken?.accessToken ?? ''}
                    dataCloudAccessToken={authentication?.offcoreRawJwt ?? ''}
                    dataCloudInstanceUrl={authentication?.offcoreInstanceUrl ?? ''}
                    coreTenantId={authentication?.coreTenantId ?? ''}
                    dataCloudTenantId={authentication?.offcoreTenantId ?? ''}
                    instanceUrlValidation={instanceUrlValidation}
                    appConsumerValidation={appConsumerValidation}
                    updateInstanceUrl={event => setInstanceUrl(event.target.value)}
                    updateAppConsumerKey={event => setAppConsumerKey(event.target.value)}
                    updateLogin={event => setLoginHint(event.target.value)}
                    setupConnection={setupConnection}
                    cancelSetup={props.onCancel}
                    resetSetup={props.onCancel}
                    onClose={props.onCancel}
                    alias={{
                        inputRef: aliasInputRef,
                        value: alias,
                        onChange: event => setAlias(event.target.value),
                        validation: aliasValidation,
                        name: 'Salesforce Login Name',
                        caption: 'Name saved in login history',
                    }}
                    statusText={props.state.status}
                    indicatorStatus={props.state.indicator}
                    statusError={props.state.statusError}
                    connectionHealth={connectionHealth}
                    connectorNameAction={props.loadHistory ? (
                        <SalesforceLoginHistoryButton
                            open={historyOpen}
                            loadHistory={props.loadHistory}
                            deleteHistoryEntry={props.deleteHistoryEntry}
                            onOpenChange={setHistoryOpen}
                            onSelect={selectHistoryEntry}
                        />
                    ) : null}
                />
            </section>
        </Overlay>
    );
}

interface SalesforceLoginHistoryButtonProps {
    open: boolean;
    loadHistory: () => Promise<SalesforceLoginHistoryEntry[]>;
    deleteHistoryEntry?: (organizationId: string) => Promise<SalesforceLoginHistoryEntry[]>;
    onOpenChange: (open: boolean) => void;
    onSelect: (entry: SalesforceLoginHistoryEntry) => void;
}

function SalesforceLoginHistoryButton(props: SalesforceLoginHistoryButtonProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const overlayRef = React.useRef<HTMLElement>(null);
    const [entries, setEntries] = React.useState<SalesforceLoginHistoryEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [deletingOrganizationId, setDeletingOrganizationId] = React.useState<string | null>(null);

    useFocusTrap({
        containerRef: overlayRef as React.RefObject<HTMLElement>,
        initialFocusRef: overlayRef as React.RefObject<HTMLElement>,
        disabled: !props.open,
        returnFocusRef: buttonRef as React.RefObject<HTMLElement>,
    });

    const { open, loadHistory, onOpenChange, deleteHistoryEntry } = props;
    React.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        void loadHistory().then(nextEntries => {
            if (!cancelled) setEntries(nextEntries);
        }).catch(loadError => {
            if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [loadHistory, open]);

    React.useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
                onOpenChange(false);
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, [onOpenChange, open]);

    const deleteEntry = React.useCallback(async (entry: SalesforceLoginHistoryEntry) => {
        if (!deleteHistoryEntry || deletingOrganizationId != null) return;
        setDeletingOrganizationId(entry.organizationId);
        setError(null);
        try {
            setEntries(await deleteHistoryEntry(entry.organizationId));
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
        } finally {
            setDeletingOrganizationId(null);
        }
    }, [deletingOrganizationId, deleteHistoryEntry]);

    return (
        <div ref={containerRef} className={styles.historyAnchor}>
            <button
                ref={buttonRef}
                type="button"
                className={styles.historyButton}
                aria-label="Recent Salesforce logins"
                aria-haspopup="dialog"
                data-testid="salesforce-login-history-toggle"
                aria-expanded={props.open}
                onClick={() => props.onOpenChange(!props.open)}
            >
                <HistoryIcon size={16} />
            </button>
            {props.open && (
                <section
                    ref={overlayRef}
                    className={styles.historyOverlay}
                    role="dialog"
                    aria-labelledby="salesforce-login-history-title"
                    tabIndex={-1}
                    data-testid="salesforce-login-history"
                >
                    <div className={styles.historyHeader}>
                        <h2 id="salesforce-login-history-title">Recent logins</h2>
                    </div>
                    <div className={styles.historyList}>
                        {loading ? (
                            <div className={styles.historyState} role="status">Loading recent logins...</div>
                        ) : error ? (
                            <div className={styles.historyError} role="alert">Could not load recent logins: {error}</div>
                        ) : entries.length === 0 ? (
                            <div className={styles.historyState} data-testid="salesforce-login-history-empty">
                                Successful logins will appear here.
                            </div>
                        ) : (
                            <ul aria-label="Recent Salesforce logins" data-testid="salesforce-login-history-list">
                                {entries.map(entry => (
                                    <li key={entry.organizationId.toLowerCase()}>
                                        <button
                                            type="button"
                                            className={styles.historySelectButton}
                                            data-testid="salesforce-login-history-entry"
                                            data-organization-id={entry.organizationId}
                                            onClick={() => props.onSelect(entry)}
                                        >
                                            <svg width="20px" height="20px" aria-hidden="true">
                                                <use xlinkHref={`${symbols}#salesforce_notext`} />
                                            </svg>
                                            <span className={styles.historyLabels}>
                                                <span className={styles.historyName}>{entry.name}</span>
                                                <span className={styles.historyUrl}>{entry.instanceUrl}</span>
                                            </span>
                                        </button>
                                        {props.deleteHistoryEntry && (
                                            <button
                                                type="button"
                                                className={styles.historyDeleteButton}
                                                data-testid="salesforce-login-history-delete"
                                                data-organization-id={entry.organizationId}
                                                aria-label={`Delete ${entry.name} from recent logins`}
                                                disabled={deletingOrganizationId != null}
                                                onClick={() => void deleteEntry(entry)}
                                            >
                                                <TrashIcon size={16} />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}
