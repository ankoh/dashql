import * as React from 'react';
import styles from './system_card.module.css';
import classNames from 'classnames';

import icon_chevron_right from '../../static/svg/icons/chevron_right.svg';
import icon_close from '../../static/svg/icons/close.svg';

interface Props {
    className?: string;
    children?: React.ReactNode;
    title: string;
    onClose?: () => void;
}

export class SystemCard extends React.Component<Props> {
    public render() {
        return (
            <div className={classNames(styles.panel, this.props.className)}>
                <div className={styles.header}>
                    <div className={styles.header_title}>{this.props.title}</div>
                    <div className={styles.close} onClick={this.props.onClose}>
                        <svg width="20px" height="20px">
                            <use xlinkHref={`${icon_close}#sym`} />
                        </svg>
                    </div>
                </div>
                {this.props.children}
            </div>
        );
    }
}
