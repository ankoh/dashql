import * as React from 'react';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { AnchoredOverlay } from './foundations/anchored_overlay.js';
import { OverlaySize } from './foundations/overlay.js';
import { LogViewer } from './logs/log_viewer.js';

interface Props {
    isOpen: boolean;
    onOpen?: () => void;
    onClose: () => void;
    renderAnchor: (props: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
}

export const LogsOverlay: React.FC<Props> = props => (
    <AnchoredOverlay
        open={props.isOpen}
        onOpen={props.onOpen}
        onClose={props.onClose}
        renderAnchor={props.renderAnchor}
        side={props.side}
        align={props.align}
        anchorOffset={props.anchorOffset}
        overlayProps={{ width: OverlaySize.XL, height: OverlaySize.L }}
    >
        <LogViewer onClose={props.onClose} />
    </AnchoredOverlay>
);
