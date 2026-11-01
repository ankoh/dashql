import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import type { SessionScripts } from '../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { SessionInputCard } from './session_input_card.js';
import { useApplySessionInput } from './use_apply_session_input.js';
import { useSessionInputs } from './session_inputs.js';

import * as styles from './session_inputs.module.css';

interface Props {
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    /// Chips that go before the inputs, e.g. the attachments of the feed
    leading?: React.ReactNode;
    /// Content below the chips, e.g. the open drawer of the attachments
    below?: React.ReactNode;
    className?: string;
    /// Report the height of the strip, the content below starts under it
    onHeight?: (height: number) => void;
}

/// The inputs of a session as chips on a translucent strip that floats over the top of a view. Renders nothing
/// without inputs and leading chips.
export function SessionInputStrip(props: Props): React.ReactElement | null {
    const inputs = useSessionInputs(props.sessionScripts);
    const { apply, literalOf, busyInputs } = useApplySessionInput(props.sessionScripts, props.modifySessionScripts);
    const ref = React.useRef<HTMLDivElement | null>(null);
    const empty = inputs.length === 0 && props.leading == null;
    const onHeight = props.onHeight;
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (element == null || onHeight == null) {
            onHeight?.(0);
            return;
        }
        const report = () => onHeight(element.offsetHeight);
        report();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(report);
        observer.observe(element);
        return () => observer.disconnect();
    }, [onHeight, empty]);
    if (empty) return null;
    return (
        <div ref={ref} className={classNames(styles.strip, props.className)} data-testid="session-input-strip">
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
