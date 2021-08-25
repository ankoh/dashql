import React from 'react';
import copy from 'copy-to-clipboard';

interface Props {
    duration?: number;
}

export function useClipboard(text: string, options?: Props): [boolean, () => void] {
    const [isCopied, setCopied] = React.useState(false);
    const duration = options?.duration;
    React.useEffect((): (() => void) => {
        if (isCopied && duration) {
            const timer = setTimeout(() => {
                setCopied(false);
            }, duration);
            return () => {
                clearTimeout(timer);
            };
        }
        return undefined;
    }, [isCopied, duration]);

    return [isCopied, () => setCopied(copy(text))];
}
