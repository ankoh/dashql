import * as React from 'react';

type KeyEventCallback = (event: KeyboardEvent) => void;

export interface KeyEventHandler {
    key: string;
    ctrlKey?: boolean;
    capture?: boolean;
    callback: KeyEventCallback;
}

export function useKeyEvents(subscribers: KeyEventHandler[]) {
    const subscribersRef = React.useRef<KeyEventHandler[]>([]);
    React.useEffect(() => {
        subscribersRef.current = subscribers;
    }, [subscribers]);
    const handleKeyPress = React.useCallback((event: KeyboardEvent, capture: boolean) => {
        for (const subscriber of subscribersRef.current) {
            const ctrlKeyMatches = subscriber.ctrlKey === undefined || subscriber.ctrlKey === event.ctrlKey;
            const captureMatches = (subscriber.capture ?? false) === capture;
            if (captureMatches && ctrlKeyMatches && subscriber.key == event.key) {
                subscriber.callback(event);
            }
        }
    }, []);
    const handleKeyPressCapture = React.useCallback<(event: KeyboardEvent) => void>((event: KeyboardEvent) => {
        handleKeyPress(event, true);
    }, [handleKeyPress]);
    const handleKeyPressBubble = React.useCallback<(event: KeyboardEvent) => void>((event: KeyboardEvent) => {
        handleKeyPress(event, false);
    }, [handleKeyPress]);
    React.useEffect(() => {
        const target = document;
        if (target) {
            target.addEventListener('keydown', handleKeyPressCapture, true);
            target.addEventListener('keydown', handleKeyPressBubble);
            return () => {
                target.removeEventListener('keydown', handleKeyPressCapture, true);
                target.removeEventListener('keydown', handleKeyPressBubble);
            };
        } else {
            return () => {};
        }
    }, [handleKeyPressBubble, handleKeyPressCapture, document]);
}
