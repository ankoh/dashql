import * as React from 'react';
import * as styles from './agent_settings_view.module.css';

import { XIcon } from '../../../ui/foundations/symbol_icon.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { SegmentedControl } from '../../../ui/foundations/segmented_control.js';
import { TextField, VALIDATION_ERROR, type TextFieldValidationStatus } from '../../../ui/foundations/text_field.js';
import type { AgentServerInfo } from '../../../platform/agent/agent_protocol.js';
import { AgentConnectionStatus } from '../../../platform/agent/agent_client.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { DASHQL_AGENT_PORT } from '../../../globals.js';
import { useAgentBridge, type AgentBridge } from '../../agent/agent_bridge.js';

const LOG_CTX = 'agent_settings';

/// The connection state shown in the status bar
function statusText(bridge: AgentBridge): [string, string] {
    if (!bridge.supported) return ['unsupported', 'This browser cannot reach the local agent server'];
    switch (bridge.status) {
        case AgentConnectionStatus.Connected: return ['connected', `Connected to the agent server on port ${bridge.port}`];
        case AgentConnectionStatus.Connecting: return ['connecting', `Looking for the agent server on port ${bridge.port}`];
        default: return ['off', 'Not connected'];
    }
}

/// Parse a port, null if it is invalid
function parsePort(text: string): number | null {
    const port = Number(text.trim());
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/// The settings of the agent bridge: the port, the harness, the sessions with agent access.
/// The harness commands are only shown: they live in the config.json of the agent server, a page must not
/// be able to choose the programs that run on the machine.
export function AgentSettingsView(props: { onClose: () => void }) {
    const bridge = useAgentBridge();
    const [info, setInfo] = React.useState<AgentServerInfo | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [portDraft, setPortDraft] = React.useState<string>(String(bridge?.port ?? DASHQL_AGENT_PORT));
    React.useEffect(() => setPortDraft(String(bridge?.port ?? DASHQL_AGENT_PORT)), [bridge?.port]);

    // The settings show the agent server even while no session has agent access
    React.useEffect(() => bridge?.hold(), [bridge?.hold]);

    const connected = bridge?.status === AgentConnectionStatus.Connected;
    const refresh = React.useCallback(() => {
        if (bridge == null || !connected) {
            setInfo(null);
            return;
        }
        bridge.info().then(
            next => { setInfo(next); setError(null); },
            e => setError(stringifyError(e)),
        );
    }, [bridge, connected]);
    React.useEffect(refresh, [refresh]);

    if (bridge == null) return null;
    const [status, text] = statusText(bridge);
    const portValue = parsePort(portDraft);
    const portValidation: TextFieldValidationStatus | undefined = portValue == null
        ? { type: VALIDATION_ERROR, value: 'A port between 1 and 65535' }
        : undefined;
    const setDefaultHarness = (harness: string) => {
        bridge.setDefaultHarness(harness).then(refresh, e => setError(stringifyError(e)));
    };

    return (
        <div className={styles.settings_root}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Agent Bridge</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton variant={ButtonVariant.Invisible} aria-label="close-overlay" onClick={props.onClose}>
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.body}>
                <div className={styles.status_section}>
                    <span className={styles.dot} data-status={status} />
                    <div className={styles.status_text} data-testid="agent-settings-status">
                        {text}
                        {error != null && <span className={styles.status_detail}>{error}</span>}
                    </div>
                    <Button size={ButtonSize.Small} onClick={refresh} disabled={!connected}>Refresh</Button>
                </div>

                <div className={styles.section}>
                    <div className={styles.section_layout}>
                        <div className={styles.section_title}>Agent server</div>
                        <div className={styles.port_row}>
                            <TextField
                                name="Port"
                                caption="The port of the agent server on 127.0.0.1"
                                value={portDraft}
                                onChange={e => setPortDraft(e.target.value)}
                                validation={portValidation}
                                logContext={LOG_CTX}
                                data-testid="agent-settings-port"
                            />
                            <Button
                                size={ButtonSize.Small}
                                disabled={portValue == null || portValue === bridge.port}
                                onClick={() => bridge.setPort(portValue === DASHQL_AGENT_PORT ? null : portValue)}
                            >
                                Apply
                            </Button>
                            <Button
                                size={ButtonSize.Small}
                                variant={ButtonVariant.Invisible}
                                disabled={bridge.port === DASHQL_AGENT_PORT}
                                onClick={() => bridge.setPort(null)}
                            >
                                Default
                            </Button>
                        </div>
                        {info != null ? (
                            <TextField
                                name="Configuration"
                                caption={info.dev ? 'Dev server, accepts the origins of the dev servers' : 'The token and the harness commands of the agent server'}
                                value={info.configPath}
                                readOnly
                                logContext={LOG_CTX}
                            />
                        ) : (
                            <div className={styles.hint}>
                                Start the agent server with <code>dashql agent serve</code>
                                {bridge.port !== 47100 ? <> (<code>--dev</code> for port 47101)</> : null} and turn on agent
                                access for a session in its composer.
                            </div>
                        )}
                    </div>
                </div>

                {info != null && (
                    <div className={styles.section}>
                        <div className={styles.section_layout}>
                            <div className={styles.section_title}>Harness</div>
                            <div className={styles.hint}>The harness that answers questions asked in DashQL.</div>
                            <SegmentedControl
                                aria-label="Harness"
                                onChange={index => setDefaultHarness(info.harnesses[index].name)}
                            >
                                {info.harnesses.map(harness => (
                                    <SegmentedControl.Button
                                        key={harness.name}
                                        selected={harness.name === info.defaultHarness}
                                        data-testid="agent-settings-harness"
                                        data-harness={harness.name}
                                    >
                                        {harness.name}
                                    </SegmentedControl.Button>
                                ))}
                            </SegmentedControl>
                            <div className={styles.harness_list}>
                                {info.harnesses.map(harness => (
                                    <div key={harness.name} className={styles.harness}>
                                        <span className={styles.harness_name}>{harness.name}</span>
                                        <span className={styles.harness_program} data-missing={harness.program == null ? '' : undefined}>
                                            {harness.program ?? `${harness.command[0]} is not installed`}
                                        </span>
                                        <span className={styles.command}>{harness.command.join(' ')}</span>
                                    </div>
                                ))}
                            </div>
                            <div className={styles.hint}>
                                The commands are changed in <code>{info.configPath}</code>. The app only picks among them,
                                so a page can never choose the programs that run on this machine.
                            </div>
                        </div>
                    </div>
                )}

                <div className={styles.section}>
                    <div className={styles.section_layout}>
                        <div className={styles.section_title}>Sessions with agent access</div>
                        {bridge.accessSessions.length === 0 ? (
                            <div className={styles.hint}>No session. Turn on agent access in the composer of a session.</div>
                        ) : (
                            <div className={styles.entry_list}>
                                {bridge.accessSessions.map(session => (
                                    <div key={session.id} className={styles.entry} data-testid="agent-settings-session">
                                        <span>
                                            {session.name != null && session.name.length > 0 ? session.name : 'Unnamed session'}
                                            <span className={styles.entry_id}>{session.id}</span>
                                        </span>
                                        <Button size={ButtonSize.Small} onClick={() => bridge.setAccess(session.id, false)}>
                                            Turn off
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {info != null && (
                    <div className={styles.section}>
                        <div className={styles.section_layout}>
                            <div className={styles.section_title}>Clients and runs</div>
                            <div className={styles.entry_list}>
                                {info.clients.map(client => (
                                    <div key={client.id} className={styles.entry}>
                                        <span>
                                            {client.kind} ({client.origin})
                                            <span className={styles.entry_id}>{client.sessions.length} session{client.sessions.length === 1 ? '' : 's'}</span>
                                        </span>
                                    </div>
                                ))}
                                {info.runs.map(run => (
                                    <div key={run.runId} className={styles.entry}>
                                        <span>
                                            {run.harness}, {run.state}: {run.status}
                                            <span className={styles.entry_id}>{run.session}</span>
                                        </span>
                                        <Button size={ButtonSize.Small} onClick={() => { void bridge.cancel(run.session).then(refresh); }}>
                                            Stop
                                        </Button>
                                    </div>
                                ))}
                                {info.runs.length === 0 && <div className={styles.hint}>No harness runs.</div>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
