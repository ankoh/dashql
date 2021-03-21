import * as React from 'react';
import styles from './viz_card.module.css';
import Button from 'react-bootstrap/Button';

import icon_settings from '../../../static/svg/icons/settings.svg';

interface Props {
    children?: JSX.Element[] | JSX.Element;
    className?: string;
    title?: string;
    controls?: boolean;
}

export const VizCard: React.FC<Props> = (props: Props) => {
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>{props.title}</div>
                {props.controls && (
                    <Button size="sm" variant="link" className={styles.settings}>
                        <svg width="14px" height="14px">
                            <use xlinkHref={`${icon_settings}#sym`} />
                        </svg>
                    </Button>
                )}
            </div>
            <div className={styles.body}>{props.children}</div>
        </div>
    );
};
