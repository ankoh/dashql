import * as React from 'react';
import * as buf from "@bufbuild/protobuf";
import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from './view/banner_page.module.css';
import * as styles from './oauth_redirect.module.css';

import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import type { OAuthState, OAuthRedirectData, AppEventData } from './connection/connection_types.js';

import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom';

import { AnchorAlignment, AnchorSide } from './view/foundations/anchored_position.js';
import { BASE64URL_CODEC } from './utils/base64.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from './view/foundations/button.js';
import { CopyToClipboardButton } from './utils/clipboard.js';
import { DASHQL_VERSION } from './globals.js';
import { GitHubTheme } from './github_theme.js';
import { InternalsViewerOverlay } from './view/internals/internals_overlay.js';
import { Logger } from './platform/logger/logger.js';
import { LoggerProvider, useLogger } from './platform/logger/logger_provider.js';
import { Result, RESULT_ERROR, RESULT_OK } from './utils/result.js';
import { TextField, TextFieldValidationStatus, VALIDATION_ERROR, VALIDATION_WARNING } from './view/foundations/text_field.js';
import { classNames } from './utils/classnames.js';
import { formatHHMMSS, formatTimeDifference } from './utils/format.js';
import { OAUTH_BROADCAST_CHANNEL } from './platform/events/event.js';

import '../static/fonts/fonts.css';
import './globals.css';

const AUTO_TRIGGER_DELAY = 2000;
const AUTO_TRIGGER_COUNTER_INTERVAL = 200;

const LOG_CTX = "oauth_redirect";

interface OAuthSucceededProps {
    params: URLSearchParams;
    state: OAuthState;
}

function buildDeepLink(eventBase64: string) {
    return new URL(`dashql://localhost?data=${eventBase64}`);
}

function triggerFlow(state: OAuthState, eventBase64: string, deepLink: string, logger: Logger) {
    switch (state.flowVariant) {
        case "NATIVE_LINK_FLOW": {
            logger.info(`opening deep link`, { "link": deepLink }, LOG_CTX);
            window.open(deepLink, '_self');
            break;
        }
        case "WEB_OPENER_FLOW": {
            // COOP (Cross-Origin-Opener-Policy: same-origin) severs window.opener after
            // the popup navigates to Salesforce. Use BroadcastChannel as the primary path
            // since it works same-origin regardless of COOP, and fall back to postMessage
            // for environments that lack BroadcastChannel support.
            logger.info(`posting oauth data via broadcast channel`, { "data": eventBase64 }, LOG_CTX);
            const channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
            channel.postMessage(eventBase64);
            channel.close();
            if (window.opener) {
                window.opener.postMessage(eventBase64);
            }
            break;
        }
    }
}

const OAuthSucceeded: React.FC<OAuthSucceededProps> = (props: OAuthSucceededProps) => {
    const logger = useLogger();

    const code = props.params.get('code') ?? '';
    const now = new Date();
    const [logsAreOpen, setLogsAreOpen] = React.useState<boolean>(false);

    // Encode the event as base64
    const { eventBase64, deepLink } = React.useMemo(() => {
        const eventMessage: AppEventData = {
            oauthRedirect: {
                code,
                state: props.state
            }
        };
        // Encode to JSON
        const eventJson = JSON.stringify(eventMessage);
        const eventBuffer = new TextEncoder().encode(eventJson);
        const event = BASE64URL_CODEC.encode(eventBuffer.buffer);
        return {
            eventBase64: event,
            deepLink: buildDeepLink(event).toString(),
        }
    }, [code, props.state]);

    // Setup auto-trigger
    const skipAutoTrigger = props.state.flowVariant == "NATIVE_LINK_FLOW" && props.state.debugMode;
    const autoTriggersAt = React.useMemo(() => new Date(now.getTime() + AUTO_TRIGGER_DELAY), []);
    const [remainingUntilAutoTrigger, setRemainingUntilAutoTrigger] = React.useState<number>(() => Math.max(autoTriggersAt.getTime(), now.getTime()) - now.getTime());
    const [wasTriggered, setWasTriggered] = React.useState<boolean>(false);

    React.useEffect(() => {
        // Skip auto trigger for native apps in debug mode
        if (skipAutoTrigger) {
            logger.info(`Skipping auto-trigger for native app in debug mode`, {}, LOG_CTX);
            return () => { };
        } else {
            logger.info("Setup auto-trigger", { "remaining": formatHHMMSS(remainingUntilAutoTrigger / 1000) }, LOG_CTX);
            const timeoutId = setTimeout(() => {
                triggerFlow(props.state, eventBase64, deepLink, logger);
                setWasTriggered(true);
            }, remainingUntilAutoTrigger);
            const updaterId: { current: unknown | null } = { current: null };

            const updateRemaining = () => {
                const now = new Date();
                const remainder = Math.max(autoTriggersAt.getTime(), now.getTime()) - now.getTime();
                setRemainingUntilAutoTrigger(remainder);
                if (remainder > AUTO_TRIGGER_COUNTER_INTERVAL) {
                    updaterId.current = setTimeout(updateRemaining, AUTO_TRIGGER_COUNTER_INTERVAL);
                }
            };
            updaterId.current = setTimeout(updateRemaining, AUTO_TRIGGER_COUNTER_INTERVAL);

            return () => {
                clearTimeout(timeoutId);
                if (updaterId.current != null) {
                    clearTimeout(updaterId.current as any);
                }
            }
        }
    }, [props.state, code]);

    // Render provider options
    let providerOptionsSection: React.ReactElement = <div />;
    let codeExpiresAt: Date | undefined = undefined;
    // eslint-disable-next-line prefer-const
    let [codeIsExpired, setCodeIsExpired] = React.useState(false);
    if (props.state.salesforceProvider) {
        const salesforceProvider = props.state.salesforceProvider;
        const expiresAt = salesforceProvider.expiresAt;
        codeIsExpired = now.getTime() > (expiresAt ?? 0);
        codeExpiresAt = codeIsExpired ? undefined : new Date(Number(expiresAt));
        providerOptionsSection = (
            <div className={baseStyles.card_section}>
                <div className={baseStyles.section_entries}>
                    <TextField
                        name="Salesforce Instance URL"
                        value={salesforceProvider.instanceUrl}
                        leadingVisual={() => <div>URL</div>}
                        logContext={LOG_CTX}
                        readOnly
                        disabled
                    />
                    <TextField
                        name="Connected App"
                        value={salesforceProvider.appConsumerKey}
                        leadingVisual={() => <div>ID</div>}
                        logContext={LOG_CTX}
                        readOnly
                        disabled
                    />
                </div>
            </div>
        );
    }

    // Determine the time we have left
    const remainingUntilExpiration = codeExpiresAt !== undefined
        ? (Math.max(codeExpiresAt.getTime(), now.getTime()) - now.getTime()) : 0;
    React.useEffect(() => {
        logger.info("Determining code expiration", { "remaining": formatHHMMSS(remainingUntilExpiration / 1000) }, LOG_CTX);
        const timeoutId = setTimeout(() => setCodeIsExpired(true), remainingUntilExpiration);
        return () => clearTimeout(timeoutId);
    }, [props.state]);

    // Get expiration validation
    let codeExpirationValidation: TextFieldValidationStatus;
    const codeIsEmpty = (props.params.get('code') ?? '').length == 0;
    if (codeIsEmpty) {
        codeExpirationValidation = {
            type: VALIDATION_ERROR,
            value: "Code is empty"
        };
    } else {
        codeExpirationValidation = codeIsExpired ? {
            type: VALIDATION_ERROR,
            value: "Code is expired"
        } : {
            type: VALIDATION_WARNING,
            value: `Code expires ${(formatTimeDifference(codeExpiresAt!, now))}`
        };
    }

    // Get flow continuation
    let flowContinuation: React.ReactElement = <div />;
    switch (props.state.flowVariant) {
        case "WEB_OPENER_FLOW": {
            flowContinuation = (
                <div className={baseStyles.card_section}>
                    <div className={baseStyles.section_entries}>
                        <div className={baseStyles.section_description}>
                            The authorization code was sent to the app automatically.
                            If the app did not receive it, copy the event data below and paste it into the app window.
                        </div>
                        <TextField
                            name="OAuth Event Data"
                            value={eventBase64}
                            leadingVisual={() => <div>Data</div>}
                            logContext={LOG_CTX}
                            readOnly
                            disabled
                            concealed
                        />
                    </div>
                    <div className={baseStyles.card_actions}>
                        <div className={baseStyles.card_actions_right}>
                            <CopyToClipboardButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Medium}
                                logContext={LOG_CTX}
                                value={eventBase64}
                                aria-label="copy-event-data"
                                aria-labelledby=""
                            />
                        </div>
                    </div>
                </div>
            );
            break;
        }
        case "NATIVE_LINK_FLOW": {
            if (props.state.debugMode) {
                flowContinuation = (
                    <div className={baseStyles.card_section}>
                        <div className={baseStyles.section_entries}>
                            <div className={baseStyles.section_description}>
                                The initiator is a native app in debug mode which cannot register as deep link handler.
                                Copy the following url and paste it anywhere into the app window.
                            </div>
                            <TextField
                                name="Native OAuth Callback"
                                value={buildDeepLink(eventBase64).toString()}
                                leadingVisual={() => <div>URL</div>}
                                logContext={LOG_CTX}
                                readOnly
                                disabled
                            />
                        </div>
                    </div>
                );

            } else {
                flowContinuation = (
                    <div className={baseStyles.card_section}>
                        <div className={baseStyles.section_entries}>
                            <div className={baseStyles.section_description}>
                                Your browser should prompt you to open the native app. You can retry until the code expires.
                            </div>
                        </div>
                        <div className={baseStyles.card_actions}>
                            <div className={baseStyles.card_actions_right}>
                                <CopyToClipboardButton
                                    variant={ButtonVariant.Primary}
                                    size={ButtonSize.Medium}
                                    logContext={LOG_CTX}
                                    value={deepLink}
                                    aria-label="copy-deeplink"
                                    aria-labelledby=""
                                />
                                {
                                    wasTriggered
                                        ? <Button
                                            variant={ButtonVariant.Primary}
                                            onClick={() => triggerFlow(props.state, eventBase64, deepLink, logger)}
                                        >
                                            Open in App
                                        </Button>
                                        : <Button
                                            variant={ButtonVariant.Primary}
                                            onClick={() => triggerFlow(props.state, eventBase64, deepLink, logger)}
                                            trailingVisual={() => <div>{Math.ceil(remainingUntilAutoTrigger / 1000)}</div>}
                                        >
                                            Open in App
                                        </Button>
                                }
                            </div>
                        </div>
                    </div>
                );
            }
            break;
        }
    }

    // Construct the page
    return (
        <div className={baseStyles.page}>
            <div className={classNames(baseStyles.banner_and_content_container, styles.banner_and_content_container)}>
                <div className={baseStyles.banner_container}>
                    <div className={baseStyles.banner_logo}>
                        <svg width="100%" height="100%">
                            <use xlinkHref={`${symbols}#dashql`} />
                        </svg>
                    </div>
                    <div className={baseStyles.banner_text_container}>
                        <div className={baseStyles.banner_title}>dashql</div>
                        <div className={baseStyles.app_version}>version {DASHQL_VERSION}</div>
                    </div>
                </div>
                <div className={baseStyles.content_container}>
                    <div className={baseStyles.card}>
                        <div className={baseStyles.card_header}>
                            <div className={baseStyles.card_header_left_container}>
                                <div className={baseStyles.card_header_left_title}>Authorization Succeeded</div>
                            </div>
                            <div className={baseStyles.card_header_right_container}>
                                <InternalsViewerOverlay
                                    isOpen={logsAreOpen}
                                    onClose={() => setLogsAreOpen(false)}
                                    renderAnchor={(p: object) => (
                                        <IconButton
                                            {...p}
                                            variant={ButtonVariant.Invisible}
                                            aria-label="open-logs"
                                            onClick={() => setLogsAreOpen(s => !s)}
                                        >
                                            <svg width="16px" height="16px">
                                                <use xlinkHref={`${symbols}#processor`} />
                                            </svg>
                                        </IconButton>
                                    )}
                                    side={AnchorSide.OutsideBottom}
                                    align={AnchorAlignment.End}
                                    anchorOffset={16}
                                />
                            </div>
                        </div>
                        {providerOptionsSection}
                        <div className={baseStyles.card_section}>
                            <div className={baseStyles.section_entries}>
                                <TextField
                                    name="Authorization Code"
                                    value={code ?? ""}
                                    leadingVisual={() => <div>Code</div>}
                                    validation={codeExpirationValidation}
                                    logContext={LOG_CTX}
                                    readOnly
                                    disabled
                                    concealed
                                />
                            </div>
                        </div>
                        {flowContinuation}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface OAuthFailedProps {
    error: Error;
}

const OAuthFailed: React.FC<OAuthFailedProps> = (props: OAuthFailedProps) => {
    return (
        <div className={baseStyles.page}>
            <div className={baseStyles.banner_container}>
                <div className={baseStyles.banner_logo}>
                    <svg width="100%" height="100%">
                        <use xlinkHref={`${symbols}#dashql`} />
                    </svg>
                </div>
                <div className={baseStyles.banner_text_container}>
                    <div className={baseStyles.banner_title}>dashql</div>
                    <div className={baseStyles.app_version}>version {DASHQL_VERSION}</div>
                </div>
            </div>
            <div className={baseStyles.card}>
                <div className={baseStyles.card_header}>
                    <div>Authorization Failed</div>
                </div>
                {props.error.toString()}
            </div>
        </div>
    );
}


interface RedirectPageProps { }


const RedirectPage: React.FC<RedirectPageProps> = (_props: RedirectPageProps) => {
    const [params, _setParams] = useSearchParams();
    const state = params.get("state") ?? "";

    const authState = React.useMemo<Result<OAuthState>>(() => {
        try {
            const authStateBuffer = BASE64URL_CODEC.decode(state);
            const authStateString = new TextDecoder().decode(authStateBuffer);
            return {
                type: RESULT_OK,
                value: JSON.parse(authStateString) as auth.OAuthState
            };
        } catch (e: any) {
            return {
                type: RESULT_ERROR,
                error: new Error(e.toString()),
            };
        }
    }, [state]);

    // If the state encodes a callbackUrl on a different origin, redirect the popup there
    // before doing anything else. This lets localhost dev servers receive the OAuth code
    // via BroadcastChannel even though the registered redirect_uri is dashql.app/oauth.html.
    if (authState.type == RESULT_OK) {
        const callbackUrl = authState.value.callbackUrl;
        if (callbackUrl) {
            const target = new URL(callbackUrl);
            if (target.origin !== window.location.origin) {
                // Forward all query params (code, state, error, ...) to the target origin
                target.search = window.location.search;
                window.location.replace(target.toString());
                return <div />;
            }
        }
    }

    if (authState.type == RESULT_OK) {
        return <OAuthSucceeded params={params} state={authState.value} />
    } else {
        return <OAuthFailed error={authState.error} />
    }
};

const element = document.getElementById('root');
const root = createRoot(element!);
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <GitHubTheme>
                <LoggerProvider>
                    <Routes>
                        <Route path="*" element={<RedirectPage />} />
                    </Routes>
                </LoggerProvider>
            </GitHubTheme>
        </BrowserRouter>
    </React.StrictMode>,
);
