import * as React from 'react';
import { Link } from 'react-router-dom';

import styles from './cmdbars.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';

function Action(props: { icon: string }): React.ReactElement {
    return (
        <div className={styles.cmdbar_cmd}>
            <svg width="20px" height="20px">
                <use xlinkHref={`${props.icon}#sym`} />
            </svg>
        </div>
    );
}

export class BoardCommandBar extends React.Component {
    public render(): React.ReactElement {
        return (
            <div className={styles.cmdbar_board}>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <Link to="/viewer" className={styles.cmdbar_cmd}>
                        <Action icon={icon_eye} />
                    </Link>
                </div>
            </div>
        );
    }
}
