import * as React from 'react';
import cn from 'classnames';
import { usePopper } from 'react-popper';

import styles from './card_frame.module.css';
import Button from 'react-bootstrap/Button';

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

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{props.title}</div>
                {props.controls && (
                    <Button ref={setCtrlRefElem} className={styles.settings} size="sm" variant="link">
                        <svg width="14px" height="14px">
                            <use xlinkHref={`${icon_settings}#sym`} />
                        </svg>
                    </Button>
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
            <div
                ref={setCtrlPopperElem}
                className={styles.popper}
                style={ctrlPopper.styles.popper}
                {...ctrlPopper.attributes.popper}
            >
                Popper element
                <div ref={setCtrlPopperArrowElem} className={styles.popper_arrow} style={ctrlPopper.styles.arrow} />
            </div>
        </div>
    );
};
