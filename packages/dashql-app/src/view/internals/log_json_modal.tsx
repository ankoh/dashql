import * as React from 'react';
import * as styles from './log_viewer.module.css';

import { XIcon, ChevronUpIcon, ChevronDownIcon } from '@primer/octicons-react';

import { LogRecord } from '../../platform/logger/log_buffer.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { OverlaySize } from '../foundations/overlay.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { JsonView } from '../json/json_view.js';

export interface LogJsonModalProps {
    record: LogRecord | null;
    recordIndex: number;
    maxIndex: number;
    anchorRef: React.RefObject<HTMLElement | null>;
    align?: AnchorAlignment;
    side?: AnchorSide;
    onClose: () => void;
    onPrevious: () => void;
    onNext: () => void;
}

export const LogJsonModal: React.FC<LogJsonModalProps> = (props) => {
    return (
        <AnchoredOverlay
            renderAnchor={null}
            anchorRef={props.anchorRef}
            open={props.record !== null}
            onClose={() => props.onClose()}
            width={OverlaySize.L}
            align={props.align ?? AnchorAlignment.End}
            side={props.side ?? AnchorSide.OutsideLeft}
        >
            <div className={styles.json_modal}>
                <div className={styles.json_modal_main}>
                    <div className={styles.json_modal_content}>
                        {props.record && <JsonView value={props.record as object} />}
                    </div>
                </div>
                <div className={styles.json_modal_sidebar}>
                    <div className={styles.json_modal_sidebar_top}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Close"
                            onClick={props.onClose}
                        >
                            <XIcon />
                        </IconButton>
                    </div>
                    <div className={styles.json_modal_sidebar_bottom}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Previous log"
                            onClick={props.onPrevious}
                            disabled={props.recordIndex <= 0}
                        >
                            <ChevronUpIcon />
                        </IconButton>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="Next log"
                            onClick={props.onNext}
                            disabled={props.recordIndex >= props.maxIndex}
                        >
                            <ChevronDownIcon />
                        </IconButton>
                    </div>
                </div>
            </div>
        </AnchoredOverlay>
    );
};
