import * as React from 'react';
import * as styles from '../workbook/scripts/script_connection_picker.module.css';

import { Button, ButtonSize, ButtonVariant } from '../ui/foundations/button.js';
import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { ConnectionMenu } from '../workbook/scripts/script_connection_picker.js';
import { useConnectionList, useConnections } from '../runtime/runtime_hooks.js';
import { agentConnections } from './agent_connections.js';
import type { AgentConnect } from './agent_session_provider.js';

interface Props {
    /// The workbook whose connections come first
    workbookId: string;
    /// The connections of the agent and how to change them
    connect: Pick<AgentConnect, 'excludedConnections' | 'toggleConnection'>;
}

/// The connections that the agent of the session may use, `2 / 4 connections`: the menu of the connections with a
/// checkbox each, `dashql run` refuses the unticked ones
export const AgentConnectionsPicker: React.FC<Props> = (props) => {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const connections = useConnections();
    const list = useConnectionList();
    const { excludedConnections, toggleConnection } = props.connect;
    const { listed, allowed } = React.useMemo(() => agentConnections(connections, list, excludedConnections), [connections, list, excludedConnections]);
    const label = `${allowed.connections.length} / ${listed} connections`;
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <Button
                    {...anchorProps}
                    ref={triggerRef}
                    className={styles.trigger}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={`Connections of the agent: ${label}`}
                    data-testid="composer-agent-connections"
                    title="The connections that the agent may use"
                >
                    <span className={styles.trigger_label}>{label}</span>
                </Button>
            )}
        >
            <ConnectionMenu
                workbookId={props.workbookId}
                label="the agent"
                connectionId={null}
                onPick={toggleConnection}
                checked={connectionId => !excludedConnections.has(connectionId)}
            />
        </AnchoredOverlay>
    );
};
