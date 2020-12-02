import * as React from "react";
import {
    AutoRunIcon,
    CloudUploadIcon,
    DocumentDownloadIcon,
    IIconProps,
    PlayIcon,
    UndoIcon,
} from '../svg/icons';

import styles from './studio.module.css';

class ActionProps {}

function createAction(Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<IIconProps & ActionProps> {
    return (props: IIconProps & ActionProps) => {
        return (
            <div className={styles.cmdbar_program_cmd}>
                <Icon
                    className={styles.cmdbar_program_icon}
                    width={'20px'}
                    height={'20px'}
                    {...props}
                />
            </div>
        );
    };
}

const PlayAction = createAction(PlayIcon);
const UndoAction = createAction(UndoIcon);
const AutoRunAction = createAction(AutoRunIcon);
const DocumentDownloadAction = createAction(DocumentDownloadIcon);
const CloudUploadAction = createAction(CloudUploadIcon);

export class ProgramCommandBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.cmdbar_program}>
                <div className={styles.cmdbar_program_cmdset}>
                    <PlayAction />
                    <AutoRunAction />
                    <UndoAction />
                </div>
                <div className={styles.cmdbar_program_cmdset} />
                <div className={styles.cmdbar_program_cmdset}>
                    <DocumentDownloadAction />
                    <CloudUploadAction />
                </div>
            </div>
        );
    }
};
