import * as React from 'react';
import * as styles from './agent_session_menu.module.css';

import * as ActionList from '../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { AgentConnectionStatus } from '../../platform/agent/agent_client.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { useAgentBridge, type AgentBridge } from './agent_bridge.js';

const LOG_CTX = 'agent_session_menu';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');
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

function quoteShellArg(arg: string): string {
    return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.split("'").join("'\\''")}'`;
}

interface Props {
    sessionId: string;
    /// The class of the button label, the header hides it on narrow screens
    labelClassName?: string;
}

/// The agent access of a session: "Start Session" turns it on right away, "Control Session" turns it off,
/// forgets the agent context or continues in a terminal
export const AgentSessionMenu: React.FC<Props> = (props: Props) => {
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

    if (state === AgentAccessState.Unsupported || state === AgentAccessState.Off) {
        return (
            <Button
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                leadingVisual={SparklesFillIcon}
                aria-label="Start Session"
                title={state === AgentAccessState.Unsupported
                    ? 'Safari cannot reach the local agent server. Use Chrome, Edge, Firefox or the DashQL desktop app.'
                    : 'Let agents on this machine read and edit the scripts of this session and run its queries'}
                disabled={state === AgentAccessState.Unsupported}
                data-testid="agent-access"
                data-state={state}
                onClick={() => bridge.setAccess(props.sessionId, true)}
            >
                <span className={props.labelClassName}>Start Session</span>
            </Button>
        );
    }

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => { setNotice(null); setOpen(true); }}
            onClose={close}
            side={AnchorSide.OutsideBottom}
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
                    leadingVisual={SparklesFillIcon}
                    aria-label="Control Session"
                    data-testid="agent-access"
                    data-state={state}
                >
                    <span className={props.labelClassName}>Control Session</span>
                </Button>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label="Control agent session">
                {notice == null && bridge.status === AgentConnectionStatus.Incompatible && (
                    <div className={styles.notice}>The agent server runs another version. Update DashQL or reload the page.</div>
                )}
                {notice != null && <div className={styles.notice}>{notice}</div>}
                <ActionList.List aria-label="Agent actions">
                    <ActionList.ListItem
                        data-testid="agent-menu-item"
                        data-action="disconnect"
                        onClick={() => { close(); bridge.setAccess(props.sessionId, false); }}
                    >
                        <ActionList.Leading><PlugIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Disconnect the Session</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        data-testid="agent-menu-item"
                        data-action="reset"
                        disabled={state !== AgentAccessState.Connected}
                        onClick={resetContext}
                    >
                        <ActionList.Leading><SyncIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Reset the Session</ActionList.ItemText>
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
            </div>
        </AnchoredOverlay>
    );
};
