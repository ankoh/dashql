import * as React from "react";
import {
    IIconProps,
    PlayIcon,
    AutoRunIcon,
    AspectRatioIcon,
    CloudUploadIcon,
    DocumentDownloadIcon,
    RulerIcon,
} from '../svg/icons';

import styles from './studio.module.css';

class TopBarActionProps {}

function createTopBarAction(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & TopBarActionProps> {
    return (props: IIconProps & TopBarActionProps) => {
        return (
            <div className={styles.topbar_action}>
                <Icon
                    className={styles.topbar_icon}
                    width={'20px'}
                    height={'20px'}
                    {...props}
                />
            </div>
        );
    };
}

const PlayAction = createTopBarAction(PlayIcon);
const AutoRunAction = createTopBarAction(AutoRunIcon);
const RulerAction = createTopBarAction(RulerIcon);
const DeviceAction = createTopBarAction(AspectRatioIcon);
const DocumentDownloadAction = createTopBarAction(DocumentDownloadIcon);
const CloudUploadAction = createTopBarAction(CloudUploadIcon);

export class TopBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.topbar}>
                <div className={styles.topbar_actionset}>
                    <PlayAction />
                    <AutoRunAction />
                </div>
                <div className={styles.topbar_actionset} />
                <div className={styles.topbar_actionset}>
                    <DocumentDownloadAction />
                    <CloudUploadAction />
                </div>
                <div className={styles.topbar_actionset}>
                    <RulerAction />
                    <DeviceAction />
                </div>
            </div>
        );
    }
};
