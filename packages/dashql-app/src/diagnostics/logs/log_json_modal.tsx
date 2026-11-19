import * as React from 'react';
import { InspectorDetail } from '@akohn/dashql-react/components/inspector_overlay';

import { XIcon, ChevronUpIcon, ChevronDownIcon } from '@akohn/dashql-react/components/symbol_icon';

import { LogRecord } from '@akohn/dashql/platform/logger/log_buffer';
import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { JsonView } from '@akohn/dashql-react/components/json/json_view';

export interface LogJsonModalProps {
    record: LogRecord | null;
    recordIndex: number;
    maxIndex: number;
    anchorRef: React.RefObject<HTMLElement | null>;
    returnFocusRef?: React.RefObject<HTMLElement | null>;
    align?: AnchorAlignment;
    side?: AnchorSide;
    onClose: () => void;
    onPrevious: () => void;
    onNext: () => void;
}

export const LogJsonModal: React.FC<LogJsonModalProps> = (props) => {
    const beforeCopy = React.useCallback((copyText: string, _keyName?: string | number, value?: object) => {
        // If the value is a string, remove the JSON quotes and unescape
        if (typeof value === 'string') {
            return value;
        }
        return copyText;
    }, []);

    return (
        <AnchoredOverlay
            renderAnchor={null}
            anchorRef={props.anchorRef}
            returnFocusRef={props.returnFocusRef}
            open={props.record !== null}
            onClose={() => props.onClose()}
            width={OverlaySize.L}
            align={props.align ?? AnchorAlignment.End}
            side={props.side ?? AnchorSide.OutsideLeft}
        >
            <InspectorDetail
                sidebarTop={(
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                )}
                sidebarBottom={(
                    <>
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
                    </>
                )}
            >
                {props.record && <JsonView value={props.record as object} variant="explorer" beforeCopy={beforeCopy} />}
            </InspectorDetail>
        </AnchoredOverlay>
    );
};
