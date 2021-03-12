import * as React from 'react';
import { AspectRatioIcon, IIconProps, RulerIcon } from '../svg/icons';

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

const RulerAction = createAction(RulerIcon);
const DeviceAction = createAction(AspectRatioIcon);

export class BoardCommandBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.cmdbar_board}>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <RulerAction />
                    <DeviceAction />
                </div>
            </div>
        );
    }
}
