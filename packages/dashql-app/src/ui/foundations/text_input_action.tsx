import * as React from 'react';
import * as styles from './text_input_action.module.css';

import type { IconProps } from '@primer/octicons-react';
import { Tooltip } from './tooltip.js';
import { CopyToClipboardButton } from '../../utils/clipboard.js';
import { ButtonSize, ButtonVariant, IconButton } from './button.js';

interface TextInputActionProps {
    children?: React.ReactElement;
    /// Text that appears in a tooltip. If an icon is passed, this is also used as the label used by assistive technologies.
    ['aria-label']: string;
    ['aria-labelledby']: string;
    /// Position of tooltip. If no position is passed or defaults to "n"
    tooltipDirection?: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
}
type Props = TextInputActionProps & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function TextInputAction(props: Props) {
    const ariaLabel = props['aria-label'];
    const ariaLabelledBy = props['aria-labelledby'];

    return (
        <IconButton
            className={styles.input_action}
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
            aria-labelledby={ariaLabelledBy}
            aria-label={ariaLabel}
            onClick={props.onClick}
        >
            {props.children}
        </IconButton>
    );
}

interface CopyToClipboardActionProps {
    value: string;
    timeoutMs?: number;
    logContext: string;
    ariaLabel: string;
}

export function CopyToClipboardAction(props: CopyToClipboardActionProps): React.ReactElement {
    return (
        <CopyToClipboardButton
            className={styles.input_action}
            aria-label={props.ariaLabel}
            aria-labelledby={''}
            timeoutMs={props.timeoutMs}
            logContext={props.logContext}
            value={props.value}
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
        />
    );
}
