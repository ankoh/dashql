import * as React from 'react';
import * as styles from './agent_access_menu.module.css';

import * as ActionList from '../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { AgentConnectionStatus } from '../../platform/agent/agent_client.js';
import { DEFAULT_AGENT_PORT } from '../../platform/agent/agent_protocol.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { useAgentBridge, type AgentBridge } from './agent_bridge.js';

const LOG_CTX = 'agent_access_menu';

const PlugIcon = SymbolIcon('plug_16');
const SyncIcon = SymbolIcon('sync_16');
const CopyIcon = SymbolIcon('copy_16');

/// The state of the agent bridge of a session, as the menu shows it
export enum AgentAccessState {
    /// The browser cannot reach the agent server
    Unsupported = 'unsupported',
    /// The session has no agent access
    Off = 'off',
    /// The session has agent access, the page looks for the agent server
    Connecting = 'connecting',
    /// The session has agent access, the agent server is connected
    Connected = 'connected',
}

export function agentAccessState(bridge: AgentBridge, sessionId: string): AgentAccessState {
    if (!bridge.supported) return AgentAccessState.Unsupported;
    if (!bridge.hasAccess(sessionId)) return AgentAccessState.Off;
    return bridge.status === AgentConnectionStatus.Connected ? AgentAccessState.Connected : AgentAccessState.Connecting;
}

function stateLabel(state: AgentAccessState): string {
    switch (state) {
        case AgentAccessState.Unsupported: return 'Agent unavailable';
        case AgentAccessState.Off: return 'Agent off';
        case AgentAccessState.Connecting: return 'Agent not connected';
        case AgentAccessState.Connected: return 'Agent';
    }
}

function quoteShellArg(arg: string): string {
    return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.split("'").join("'\\''")}'`;
}

interface Props {
    sessionId: string;
}

/// The agent access of a session: turn it on or off, see whether the agent server is connected,
/// forget the agent context or continue in a terminal
export const AgentAccessMenu: React.FC<Props> = (props: Props) => {
    const bridge = useAgentBridge();
    const logger = useLogger();
    const [open, setOpen] = React.useState(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    if (bridge == null) return null;
    const state = agentAccessState(bridge, props.sessionId);

    const close = () => setOpen(false);
    const resetContext = () => {
        bridge.reset(props.sessionId).then(
            () => setNotice('The next question starts a new agent session'),
            e => setNotice(`Resetting failed: ${stringifyError(e)}`),
        );
    };
    const copyTerminalCommand = () => {
        bridge.context(props.sessionId).then(context => {
            if (context.terminalCommand == null) {
                setNotice('The agent has no session to continue yet');
                return;
            }
            const command = `cd ${quoteShellArg(context.folder)} && ${context.terminalCommand.map(quoteShellArg).join(' ')}`;
            return navigator.clipboard.writeText(command).then(() => setNotice(`Copied: ${command}`));
        }).catch(e => {
            logger.warn('Cannot copy the terminal command', { error: stringifyError(e) }, LOG_CTX);
            setNotice(`Copying failed: ${stringifyError(e)}`);
        });
    };

    let hint: React.ReactNode;
    switch (state) {
        case AgentAccessState.Unsupported:
            hint = 'Safari cannot reach the local agent server. Use Chrome, Edge, Firefox or the DashQL desktop app.';
            break;
        case AgentAccessState.Off:
            hint = 'Agents on this machine can read and edit the scripts of this session and run its queries.';
            break;
        case AgentAccessState.Connecting:
            hint = <>Looking for the agent server on port {bridge.port}. Start it with <code>dashql agent serve</code>{bridge.port !== DEFAULT_AGENT_PORT ? <> <code>--dev</code></> : null} on this machine.</>;
            break;
        case AgentAccessState.Connected:
            hint = <>Agents reach this session with <code>dashql agent --session {props.sessionId}</code>.</>;
            break;
    }

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => { setNotice(null); setOpen(true); }}
            onClose={close}
            side={AnchorSide.OutsideTop}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <Button
                    {...anchorProps}
                    ref={triggerRef}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    leadingVisual={<span className={styles.dot} data-status={state} />}
                    data-testid="agent-access"
                    data-state={state}
                >
                    {stateLabel(state)}
                </Button>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label="Agent access">
                <div className={styles.status}>
                    <span className={styles.dot} data-status={state} />
                    {stateLabel(state)}
                </div>
                <div className={styles.hint}>{notice ?? hint}</div>
                {state !== AgentAccessState.Unsupported && (
                    <ActionList.List aria-label="Agent actions">
                        <ActionList.ListItem
                            data-testid="agent-menu-item"
                            data-action="toggle"
                            onClick={() => bridge.setAccess(props.sessionId, state === AgentAccessState.Off)}
                        >
                            <ActionList.Leading><PlugIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>{state === AgentAccessState.Off ? 'Turn on agent access' : 'Turn off agent access'}</ActionList.ItemText>
                        </ActionList.ListItem>
                        <ActionList.ListItem
                            data-testid="agent-menu-item"
                            data-action="reset"
                            disabled={state !== AgentAccessState.Connected}
                            onClick={resetContext}
                        >
                            <ActionList.Leading><SyncIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Reset agent context</ActionList.ItemText>
                        </ActionList.ListItem>
                        <ActionList.ListItem
                            data-testid="agent-menu-item"
                            data-action="terminal"
                            disabled={state !== AgentAccessState.Connected}
                            onClick={copyTerminalCommand}
                        >
                            <ActionList.Leading><CopyIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Continue in terminal</ActionList.ItemText>
                        </ActionList.ListItem>
                    </ActionList.List>
                )}
            </div>
        </AnchoredOverlay>
    );
};
