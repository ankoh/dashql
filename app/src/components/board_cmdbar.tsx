import * as React from 'react';
import { EyeIcon, IIconProps } from '../svg/icons';
import { Link } from 'react-router-dom';

import styles from './cmdbars.module.css';

class ActionProps {}

function createAction(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & ActionProps> {
    return (props: IIconProps & ActionProps) => {
        return (
            <div className={styles.cmdbar_cmd}>
                <Icon className={styles.cmdbar_icon} width={'20px'} height={'20px'} {...props} />
            </div>
        );
    };
}

const ViewerAction = createAction(EyeIcon);

export class BoardCommandBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.cmdbar_board}>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <Link to="/viewer" className={styles.cmdbar_cmd}>
                        <EyeIcon className={styles.cmdbar_icon} width={'20px'} height={'20px'} />
                    </Link>
                </div>
            </div>
        );
    }
}
