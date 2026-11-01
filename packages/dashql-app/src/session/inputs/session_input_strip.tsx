import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import type { SessionScripts } from '../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { SessionInputCard } from './session_input_card.js';
import { useApplySessionInput } from './use_apply_session_input.js';
import { deriveSessionInputs } from './session_inputs.js';

import * as styles from './session_inputs.module.css';

interface Props {
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    /// Chips that go before the inputs, e.g. the attachments of the feed
    leading?: React.ReactNode;
    /// Content below the chips, e.g. the open drawer of the attachments
    below?: React.ReactNode;
    className?: string;
}

/// The inputs of a session as chips on a bar at the top of a view. Renders nothing
/// without inputs and leading chips.
export function SessionInputStrip(props: Props): React.ReactElement | null {
    const inputs = deriveSessionInputs(props.sessionScripts);
    const { apply, literalOf, busyInputs } = useApplySessionInput(props.sessionScripts, props.modifySessionScripts);
    const empty = inputs.length === 0 && props.leading == null;
    if (empty) return null;
    return (
        <div className={classNames(styles.strip, props.className)} data-testid="session-input-strip">
            <div className={styles.chips} role="group" aria-label="Inputs of the session">
                {props.leading}
                {inputs.map(input => (
                    <SessionInputCard
                        key={input.name}
                        input={input}
                        busy={busyInputs.has(input.name)}
                        literalOf={literalOf}
                        onCommit={apply}
                    />
                ))}
            </div>
            {props.below}
        </div>
    );
}
