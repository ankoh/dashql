import * as React from 'react';

import type { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { SnippetBrowser } from './snippets_overlay.js';
import type { SnippetRegistry } from './snippet_registry.js';
import { useFocusTrap } from '@akohn/dashql-react/dom/focus';
import { Overlay, OverlaySize } from '@akohn/dashql-react/components/overlay';
import { PHONE_WIDTH_QUERY, useMediaQuery } from '@akohn/dashql-react/dom/media_query';
import { usePendingRequest } from '../../utils/use_pending_request.js';

const IGNORE_OUTSIDE_CLICK = () => {};

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
    const { pending, request, resolve, dismiss } = usePendingRequest<void, string | null>('snippets', null);
    const controller = React.useMemo<SnippetsDialogController>(() => ({
        request: signal => request(undefined, signal),
    }), [request]);
    return {
        controller,
        dialog: pending == null
            ? null
            : <SnippetsDialog connectorType={connectorType} registry={registry} onApply={resolve} onClose={dismiss} />,
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
    // A phone has no room around the dialog, it fills the window and stacks the list over the preview
    const phone = useMediaQuery(PHONE_WIDTH_QUERY);

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
            expanded={phone}
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
