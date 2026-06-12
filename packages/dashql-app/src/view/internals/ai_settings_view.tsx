import * as React from 'react';
import * as styles from './ai_settings_view.module.css';

import { XIcon } from '@primer/octicons-react';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { TextField } from '../foundations/text_field.js';
import { KeyValueListBuilder, KeyValueListElement } from '../foundations/keyvalue_list.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import {
    AIProviderHeader,
    AIProviderSettings,
    AppConfig,
    DEFAULT_AI_ENDPOINT_URL,
    DEFAULT_AI_MODEL,
    useAppConfig,
    useAppReconfigure,
} from '../../app_config.js';
import { AIClient } from '../../platform/ai_client.js';
import { useHttpClient } from '../../platform/http/http_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

const LOG_CTX = 'ai_settings';

interface TestState {
    status: IndicatorStatus;
    text: string;
    error?: string;
}

const INITIAL_TEST_STATE: TestState = {
    status: IndicatorStatus.None,
    text: 'Not tested',
};

function setProvider(
    reconfigure: (m: (c: AppConfig | null) => AppConfig | null) => void,
    next: AIProviderSettings,
) {
    reconfigure(c => c == null ? null : {
        ...c,
        settings: {
            ...(c.settings ?? {}),
            aiProvider: next,
        }
    });
}

const HeaderKeyIcon = () => <div>Header</div>;
const HeaderValueIcon = () => <div>Value</div>;
const UrlIcon = () => <div>URL</div>;
const ModelIcon = () => <div>Model</div>;

function headersToKeyValueList(headers: AIProviderHeader[]): KeyValueListElement[] {
    return headers.map(h => ({ key: h.name, value: h.value }));
}

function keyValueListToHeaders(elements: KeyValueListElement[]): AIProviderHeader[] {
    return elements.map(e => ({ name: e.key, value: e.value }));
}

export function AISettingsView(props: { onClose: () => void; }) {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const httpClient = useHttpClient();
    const logger = useLogger();

    const stored = config?.settings?.aiProvider;
    const endpointUrl = stored?.endpointUrl ?? DEFAULT_AI_ENDPOINT_URL;
    const model = stored?.model ?? DEFAULT_AI_MODEL;
    const providerHeaders = stored?.headers ?? [];
    const provider: AIProviderSettings = { endpointUrl, model, headers: providerHeaders };

    const [testState, setTestState] = React.useState<TestState>(INITIAL_TEST_STATE);
    const abortRef = React.useRef<AbortController | null>(null);

    React.useEffect(() => () => abortRef.current?.abort(), []);

    const onChangeEndpoint = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProvider(reconfigure, { ...provider, endpointUrl: e.target.value });
    };
    const onChangeModel = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProvider(reconfigure, { ...provider, model: e.target.value });
    };
    const modifyHeaders = (updater: (prev: KeyValueListElement[]) => KeyValueListElement[]) => {
        const current = headersToKeyValueList(providerHeaders);
        const next = updater(current);
        setProvider(reconfigure, { ...provider, headers: keyValueListToHeaders(next) });
    };

    const runTest = async () => {
        if (httpClient == null || logger == null) return;
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        setTestState({ status: IndicatorStatus.Running, text: 'Testing…' });
        try {
            const cleanHeaders: AIProviderHeader[] = providerHeaders.filter(h => h.name.trim().length > 0);
            const client = new AIClient(logger, httpClient, {
                endpointUrl,
                model,
                headers: cleanHeaders,
            });
            const models = await client.listModels(ac.signal);
            if (ac.signal.aborted) return;
            setTestState({
                status: IndicatorStatus.Succeeded,
                text: `Reachable — ${models.length} model${models.length === 1 ? '' : 's'} available`,
            });
        } catch (e: any) {
            if (ac.signal.aborted) return;
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn('AI provider test failed', { error: msg }, LOG_CTX);
            setTestState({ status: IndicatorStatus.Failed, text: 'Failed', error: msg });
        }
    };

    return (
        <div className={styles.settings_root}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>AI Provider Settings</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="close-overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.body}>
                <div className={styles.status_container}>
                    <div className={styles.status_section}>
                        <div className={styles.status_bar}>
                            <div className={styles.status_indicator}>
                                <StatusIndicator
                                    className={styles.status_indicator_spinner}
                                    status={testState.status}
                                    fill="black"
                                />
                            </div>
                            <div className={styles.status_text}>{testState.text}</div>
                            {testState.error && (
                                <div className={styles.status_error}>{testState.error}</div>
                            )}
                        </div>
                        <Button
                            variant={ButtonVariant.Primary}
                            size={ButtonSize.Small}
                            onClick={runTest}
                            disabled={httpClient == null || testState.status === IndicatorStatus.Running}
                        >
                            Test
                        </Button>
                    </div>
                </div>
                <div className={styles.section}>
                    <div className={styles.section_layout}>
                        <TextField
                            className={styles.grid_column_1}
                            name="Endpoint URL"
                            caption="Base URL of the OpenAI-compatible server"
                            value={endpointUrl}
                            placeholder="http://localhost:11434"
                            leadingVisual={UrlIcon}
                            onChange={onChangeEndpoint}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Model"
                            caption="Model identifier used for chat completions"
                            value={model}
                            placeholder="llama3"
                            leadingVisual={ModelIcon}
                            onChange={onChangeModel}
                            logContext={LOG_CTX}
                        />
                        <KeyValueListBuilder
                            className={styles.grid_column_1_span_2}
                            title="Additional Headers"
                            caption="Extra HTTP headers added to each request (e.g. Authorization)"
                            keyIcon={HeaderKeyIcon}
                            valueIcon={HeaderValueIcon}
                            addButtonLabel="Add Header"
                            elements={headersToKeyValueList(providerHeaders)}
                            modifyElements={modifyHeaders}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
