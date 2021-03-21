import * as React from 'react';
import { Link } from 'react-router-dom';

import styles from './cmdbars.module.css';

import icon_eye from '../../static/svg/icons/eye.svg';

class ActionProps {}

function createAction(icon: string): React.FunctionComponent<ActionProps> {
    return (_props: ActionProps) => {
        return (
            <div className={styles.cmdbar_cmd}>
                <svg width="20px" height="20px">
                    <use xlinkHref={`${icon}#sym`} />
                </svg>
            </div>
        );
    };
}

const ViewerAction = createAction(icon_eye);

export class BoardCommandBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.cmdbar_board}>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <Link to="/viewer" className={styles.cmdbar_cmd}>
                        <ViewerAction />
                    </Link>
                </div>
            </div>
        );
    }
}
