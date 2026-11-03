import * as React from 'react';

import * as styles from './session_url_share_overlay.module.css';

import { CheckIcon, PaperclipIcon } from '../../ui/foundations/symbol_icon.js';
import { IconButton } from '../../ui/foundations/button.js';
import { TextInput } from '../../ui/foundations/text_input.js';
import { sleep } from '../../utils/sleep.js';

const COPY_CHECKMARK_DURATION_MS = 1000;

interface Props {
    /// The link, null while it is generated
    url: string | null;
    /// The label of the link
    ariaLabel: string;
    /// The copy button, the overlay focuses it
    buttonRef?: React.Ref<HTMLButtonElement>;
}

/// A shared link with a button that copies it to the clipboard
export const ShareURLField: React.FC<Props> = ({ url, ariaLabel, buttonRef }) => {
    // Did the last copy finish and the checkmark still shows?
    const [copied, setCopied] = React.useState(false);

    const copyURL = React.useCallback((event: React.MouseEvent) => {
        if (!url) return;
        event.stopPropagation();
        const copy = async () => {
            try {
                await navigator.clipboard.writeText(url);
            } catch {
                // The checkmark shows either way
            }
            setCopied(true);
            await sleep(COPY_CHECKMARK_DURATION_MS);
            setCopied(false);
        };
        void copy();
    }, [url]);

    const ButtonIcon = copied ? CheckIcon : PaperclipIcon;
    return (
        <div className={styles.sharing_url}>
            <TextInput disabled={true} aria-label={ariaLabel} value={url ?? ''} />
            <IconButton
                ref={buttonRef}
                onClick={copyURL}
                disabled={url == null}
                aria-label="Copy to Clipboard"
            >
                <ButtonIcon />
            </IconButton>
            <div className={styles.sharing_url_stats}>{url?.length ?? 0} characters</div>
        </div>
    );
};
