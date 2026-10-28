import * as React from 'react';
import * as styles from './agent_view.module.css';

import { CheckIcon, SymbolIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../../ui/foundations/overlay.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { TextInput, TextInputValidationStatus } from '../../ui/foundations/text_input.js';
import { AgentConnectionStatus } from '../../platform/agent/agent_client.js';
import { DEFAULT_AGENT_PORT, type AgentServerInfo } from '../../platform/agent/agent_protocol.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { DASHQL_AGENT_PORT } from '../../globals.js';
import { useAgentBridge, type AgentBridge } from './agent_bridge.js';

const UndoIcon = SymbolIcon('undo_16');
const SyncIcon = SymbolIcon('sync_16');

/// The connection state of the agent server
function statusText(bridge: AgentBridge): [string, string] {
    if (!bridge.supported) return ['unsupported', 'Not reachable from this browser'];
    switch (bridge.status) {
        case AgentConnectionStatus.Connected: return ['connected', 'Connected'];
        case AgentConnectionStatus.Connecting: return ['connecting', 'Looking for the server'];
        case AgentConnectionStatus.Incompatible: return ['incompatible', 'Server version differs, update DashQL or reload'];
        default: return ['off', 'Not connected'];
    }
}

/// Parse a port, null if it is invalid
function parsePort(text: string): number | null {
    const port = Number(text.trim());
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/// The agent bridge: the agent server with its port and harness, the sessions with agent access, the turns and
/// the clients of the server.
/// The harness commands live in the config.json of the agent server, a page only picks among them and must
/// not be able to choose the programs that run on the machine. The pick is a setting of the app.
export function AgentView(props: { onClose: () => void }) {
    const bridge = useAgentBridge();
    const [info, setInfo] = React.useState<AgentServerInfo | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [portDraft, setPortDraft] = React.useState<string>(String(bridge?.port ?? DASHQL_AGENT_PORT));
    React.useEffect(() => setPortDraft(String(bridge?.port ?? DASHQL_AGENT_PORT)), [bridge?.port]);

    // The view shows the agent server even while no session has agent access
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
    const pickedHarness = bridge.harness ?? info?.defaultHarness;

    return (
        <div className={styles.settings_root}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Agent</div>
                    <div className={styles.header_status} data-testid="agent-settings-status">
                        <span className={styles.dot} data-status={status} />
                        {text}
                    </div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton variant={ButtonVariant.Invisible} aria-label="Refresh" onClick={refresh} disabled={!connected}>
                        <SyncIcon />
                    </IconButton>
                    <IconButton variant={ButtonVariant.Invisible} aria-label="close-overlay" onClick={props.onClose}>
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.body}>
                <section className={styles.section} aria-label="Agent server">
                    <div className={styles.row}>
                        <div className={styles.row_start}>
                            {info != null && (
                                <SegmentedControl
                                    aria-label="Harness"
                                    size={SegmentedControlSize.Small}
                                    onChange={index => {
                                        const name = info.harnesses[index].name;
                                        bridge.setHarness(name === info.defaultHarness ? null : name);
                                    }}
                                >
                                    {info.harnesses.map(harness => (
                                        <SegmentedControl.Button
                                            key={harness.name}
                                            selected={harness.name === pickedHarness}
                                            disabled={harness.program == null}
                                            title={harness.program == null ? `${harness.command[0]} is not installed` : undefined}
                                            data-testid="agent-settings-harness"
                                            data-harness={harness.name}
                                        >
                                            {harness.name}
                                        </SegmentedControl.Button>
                                    ))}
                                </SegmentedControl>
                            )}
                        </div>
                        <div className={styles.row_value}>
                            <label id="agent-setting-port" className={styles.row_detail}>Port</label>
                            <TextInput
                                className={styles.port_input}
                                aria-labelledby="agent-setting-port"
                                title={portValue == null ? 'A port between 1 and 65535' : 'The port of the agent server on 127.0.0.1'}
                                value={portDraft}
                                onChange={e => setPortDraft(e.target.value)}
                                validationStatus={portValue == null ? TextInputValidationStatus.Error : undefined}
                                aria-invalid={portValue == null}
                                data-testid="agent-settings-port"
                            />
                            <ButtonGroup>
                                <IconButton
                                    size={ButtonSize.Small}
                                    aria-label="Apply the port"
                                    disabled={portValue == null || portValue === bridge.port}
                                    onClick={() => bridge.setPort(portValue === DASHQL_AGENT_PORT ? null : portValue)}
                                >
                                    <CheckIcon />
                                </IconButton>
                                <IconButton
                                    size={ButtonSize.Small}
                                    aria-label="Reset to the default port"
                                    disabled={bridge.port === DASHQL_AGENT_PORT && portDraft === String(DASHQL_AGENT_PORT)}
                                    onClick={() => { setPortDraft(String(DASHQL_AGENT_PORT)); bridge.setPort(null); }}
                                >
                                    <UndoIcon />
                                </IconButton>
                            </ButtonGroup>
                        </div>
                    </div>
                    {error != null && <div className={styles.error}>{error}</div>}
                    {info == null && bridge.supported && (
                        <div className={styles.hint}>
                            Start the agent server with <code>dashql agent serve</code>
                            {bridge.port !== DEFAULT_AGENT_PORT ? <> <code>--dev</code></> : null} on this machine.
                        </div>
                    )}
                </section>

                <section className={styles.section} aria-labelledby="agent-section-sessions">
                    <h3 id="agent-section-sessions" className={styles.section_title}>Sessions</h3>
                    {bridge.accessSessions.map(session => (
                        <div key={session.id} className={styles.row} data-testid="agent-settings-session">
                            <div className={styles.row_label}>
                                {session.name != null && session.name.length > 0 ? session.name : 'Unnamed session'}
                                <span className={styles.row_detail}>{session.id}</span>
                            </div>
                            <div className={styles.row_value}>
                                <Button size={ButtonSize.Small} onClick={() => bridge.setAccess(session.id, false)}>Disconnect</Button>
                            </div>
                        </div>
                    ))}
                    {bridge.accessSessions.length === 0 && <div className={styles.hint}>No session has agent access.</div>}
                </section>

                {info != null && (
                    <section className={styles.section} aria-labelledby="agent-section-turns">
                        <h3 id="agent-section-turns" className={styles.section_title}>Turns</h3>
                        {info.turns.map(turn => (
                            <div key={turn.turnId} className={styles.row}>
                                <div className={styles.row_label}>
                                    {turn.harness} · {turn.status}
                                    <span className={styles.row_detail}>{turn.state}</span>
                                </div>
                                <div className={styles.row_value}>
                                    <Button size={ButtonSize.Small} onClick={() => { void bridge.cancel(turn.session).then(refresh); }}>Stop</Button>
                                </div>
                            </div>
                        ))}
                        {info.turns.length === 0 && <div className={styles.hint}>No agent is working.</div>}
                    </section>
                )}

                {info != null && (
                    <section className={styles.section} aria-labelledby="agent-section-clients">
                        <h3 id="agent-section-clients" className={styles.section_title}>Clients</h3>
                        {info.clients.map(client => (
                            <div key={client.id} className={styles.row}>
                                <div className={styles.row_label}>
                                    {client.kind}
                                    <span className={styles.row_detail}>{client.origin}</span>
                                </div>
                                <div className={styles.row_value}>
                                    <span className={styles.row_detail}>{client.sessions.length} session{client.sessions.length === 1 ? '' : 's'}</span>
                                </div>
                            </div>
                        ))}
                    </section>
                )}
            </div>
        </div>
    );
}

type AgentViewOverlayProps = {
    isOpen: boolean;
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
}
export function AgentViewOverlay(props: AgentViewOverlayProps) {
    return (
        <AnchoredOverlay
            open={props.isOpen}
            onClose={props.onClose}
            renderAnchor={props.renderAnchor}
            side={props.side}
            align={props.align}
            anchorOffset={props.anchorOffset}
            overlayProps={{
                width: OverlaySize.L,
                maxHeight: OverlaySize.L,
            }}
        >
            <AgentView onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
