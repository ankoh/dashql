import * as React from 'react';

import type { ConnectorType } from '../../connections/connector_info.js';
import { SnippetBrowser } from '../ui/snippets/snippets_overlay.js';
import type { SnippetRegistry } from '../snippets/snippet_registry.js';
import { useFocusTrap } from '../../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../../ui/foundations/overlay.js';

const IGNORE_OUTSIDE_CLICK = () => {};

interface PendingRequest {
    resolve: (text: string | null) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
}

export interface SnippetsDialogController {
    /// Browse the snippets, resolves with the text of the used snippet or null if the dialog was closed
    request(signal?: AbortSignal): Promise<string | null>;
}

export interface SnippetsDialogHookResult {
    controller: SnippetsDialogController;
    dialog: React.ReactElement | null;
}

/// The snippet browser of the script cards as a dialog of the shell, listing the snippets of the connector
export function useSnippetsDialog(connectorType: ConnectorType, registry?: SnippetRegistry): SnippetsDialogHookResult {
    const [open, setOpen] = React.useState(false);
    const pendingRequestRef = React.useRef<PendingRequest | null>(null);

    const finish = React.useCallback((text: string | null) => {
        const pending = pendingRequestRef.current;
        pendingRequestRef.current = null;
        if (pending?.signal != null && pending.onAbort != null) {
            pending.signal.removeEventListener('abort', pending.onAbort);
        }
        setOpen(false);
        pending?.resolve(text);
    }, []);
    const dismiss = React.useCallback(() => finish(null), [finish]);

    const request = React.useCallback((signal?: AbortSignal) => {
        if (pendingRequestRef.current != null) {
            return Promise.reject(new Error('A snippets request is already pending.'));
        }
        if (signal?.aborted) return Promise.resolve(null);

        setOpen(true);
        return new Promise<string | null>(resolve => {
            const pending: PendingRequest = { resolve, signal };
            pending.onAbort = dismiss;
            pendingRequestRef.current = pending;
            signal?.addEventListener('abort', pending.onAbort, { once: true });
        });
    }, [dismiss]);

    React.useEffect(() => () => {
        const pending = pendingRequestRef.current;
        pendingRequestRef.current = null;
        if (pending?.signal != null && pending.onAbort != null) {
            pending.signal.removeEventListener('abort', pending.onAbort);
        }
        pending?.resolve(null);
    }, []);

    const controller = React.useMemo<SnippetsDialogController>(() => ({ request }), [request]);
    return {
        controller,
        dialog: open ? <SnippetsDialog connectorType={connectorType} registry={registry} onApply={finish} onClose={dismiss} /> : null,
    };
}

interface SnippetsDialogProps {
    connectorType: ConnectorType;
    registry?: SnippetRegistry;
    onApply: (text: string) => void;
    onClose: () => void;
}

function SnippetsDialog(props: SnippetsDialogProps): React.ReactElement {
    const overlayRef = React.useRef<HTMLDivElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);

    useFocusTrap({
        containerRef: overlayRef as React.RefObject<HTMLElement>,
        initialFocusRef: listRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });

    return (
        <Overlay
            ref={overlayRef}
            centered
            width={OverlaySize.XXL}
            height={OverlaySize.L}
            preventFocusOnOpen
            onEscape={props.onClose}
            onClickOutside={IGNORE_OUTSIDE_CLICK}
        >
            <SnippetBrowser
                connectorType={props.connectorType}
                registry={props.registry}
                listRef={listRef}
                onApply={props.onApply}
                onClose={props.onClose}
            />
        </Overlay>
    );
}
