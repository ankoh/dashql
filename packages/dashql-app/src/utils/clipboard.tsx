import * as React from 'react';

import { CheckIcon, CopyIcon, Icon } from '@primer/octicons-react';

import { useLogger } from '../platform/logger_provider.js';
import { ButtonSize, ButtonVariant, IconButton } from '../view/foundations/button.js';

const DEFAULT_COPY_TIMEOUT = 2000;

interface Props {
    variant: ButtonVariant;
    size: ButtonSize;
    className?: string;
    value?: string;
    getValue?: () => string;
    timeoutMs?: number;
    logContext: string;
    disabled?: boolean;
    icon?: Icon;
    ['aria-label']: string;
    ['aria-labelledby']: string;
}
/// The icon to render inside the button
export function CopyToClipboardButton(props: Props): React.ReactElement {
    const logger = useLogger();
    const [lastCopied, setLastCopied] = React.useState<number | null>(null);
    const [wasRecentlyCopied, setWasRecentlyCopied] = React.useState<boolean>(false);
    const timeoutMs = props.timeoutMs ?? DEFAULT_COPY_TIMEOUT;
    const value = props.value ?? (props.getValue ? props.getValue() : "");

    const copy = React.useCallback(async () => {
        try {
            await navigator.clipboard.writeText(value);
            logger.error("copied to clipboard", { "chars": value.length.toString() }, props.logContext);
            setLastCopied(Date.now());
        } catch (e: any) {
            logger.error("copying failed", { "error": e.toString() }, props.logContext);
        }
    }, [setLastCopied, props.value]);

    React.useEffect(() => {
        if (lastCopied == null) {
            return;
        }
        setWasRecentlyCopied(true);
        const timeoutId = setTimeout(() => {
            setWasRecentlyCopied(false);
        }, timeoutMs);
        return () => clearTimeout(timeoutId);
    }, [lastCopied]);

    let InnerIcon: Icon;
    if (wasRecentlyCopied) {
        InnerIcon = CheckIcon;
    } else {
        InnerIcon = props.icon ?? CopyIcon;
    }

    const ariaLabel = props['aria-label'];
    const ariaLabelledBy = props['aria-labelledby'];
    return (
        <IconButton
            className={props.className}
            variant={props.variant}
            size={props.size}
            onClick={props.disabled ? undefined : copy}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            disabled={props.disabled}
        >
            <InnerIcon />
        </IconButton>
    );
}
