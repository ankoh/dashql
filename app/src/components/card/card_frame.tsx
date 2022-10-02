import * as React from 'react';
import { usePopper } from 'react-popper';

import styles from './card_frame.module.css';
import { Button, HoverMode } from '../button';

import icon_settings from '../../../static/svg/icons/settings.svg';

interface Props {
    children?: JSX.Element[] | JSX.Element;
    className?: string;
    title?: string;
    controls?: boolean;
}

export const CardFrame: React.FC<Props> = (props: Props) => {
    const [ctrlRefElem, setCtrlRefElem] = React.useState(null);
    const [ctrlPopperElem, setCtrlPopperElem] = React.useState(null);
    const [ctrlPopperArrowElem, setCtrlPopperArrowElem] = React.useState(null);
    const ctrlPopper = usePopper(ctrlRefElem, ctrlPopperElem, {
        modifiers: [{ name: 'arrow', options: { element: ctrlPopperArrowElem } }],
    });
    const [ctrlOpen, setCtrlOpen] = React.useState(false);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{props.title}</div>
                {props.controls && (
                    <div ref={setCtrlRefElem} className={styles.settings}>
                        <Button
                            className={styles.settings_button}
                            hover={HoverMode.Darken}
                            onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCtrlOpen(open => !open);
                            }}
                        >
                            <svg width="14px" height="14px">
                                <use xlinkHref={`${icon_settings}#sym`} />
                            </svg>
                        </Button>
                    </div>
                )}
            </div>
            <div
                className={styles.body}
                onMouseDown={e => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                {props.children}
            </div>
            {ctrlOpen && (
                <div
                    ref={setCtrlPopperElem}
                    className={styles.popper}
                    style={ctrlPopper.styles.popper}
                    {...ctrlPopper.attributes.popper}
                >
                    <div className={styles.popper_commands}>
                        <Button className={styles.popper_command} hover={HoverMode.Lighten} invert>
                            <div>Expand Statement</div>
                        </Button>
                    </div>
                    <div ref={setCtrlPopperArrowElem} className={styles.popper_arrow} style={ctrlPopper.styles.arrow} />
                </div>
            )}
        </div>
    );
};
