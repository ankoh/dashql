import * as React from 'react';

import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { LogViewer } from './log_viewer.js';

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
