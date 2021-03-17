import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../model';
import { AutoRunIcon, FileUploadIcon, FileDownloadIcon, IIconProps, UndoIcon } from '../svg/icons';
import { connect } from 'react-redux';

import styles from './cmdbars.module.css';

interface ActionProps extends IIconProps {
    onClick: () => void;
}

function createAction(Icon: React.FunctionComponent<ActionProps>): React.FunctionComponent<ActionProps> {
    return (props: ActionProps) => {
        return (
            <div className={styles.cmdbar_cmd} onClick={props.onClick}>
                <Icon className={styles.cmdbar_icon} width={'20px'} height={'20px'} {...props} />
            </div>
        );
    };
}

const UndoAction = createAction(UndoIcon);
const AutoRunAction = createAction(AutoRunIcon);
const DocumentDownloadAction = createAction(FileDownloadIcon);
const DocumentUploadAction = createAction(FileUploadIcon);

interface StudioCommandBarProps {
    script: core.model.Script;
    resetPlan: () => void;
}

export class StudioCommandBar extends React.Component<StudioCommandBarProps> {
    _downloadScriptAsFile = this.downloadScriptAsFile.bind(this);

    // Download the script as a file
    downloadScriptAsFile() {
        const element = document.createElement("a");
        const file = new Blob([this.props.script.text], {type: 'text/plain'});
        element.href = URL.createObjectURL(file);
        element.download = "script.dashql";
        document.body.appendChild(element); // Required for this to work in FireFox
        element.click();
    }

    public render() {
        return (
            <div className={styles.cmdbar_studio}>
                <div className={styles.cmdbar_cmdset}>
                    <AutoRunAction onClick={() => this.props.resetPlan()} />
                    <UndoAction onClick={() => {}} />
                </div>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <DocumentDownloadAction onClick={this._downloadScriptAsFile} />
                    <DocumentUploadAction onClick={() => {}} />
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    script: state.core.script
});

const mapDispatchToProps = (dispatch: model.Dispatch) => ({
    resetPlan: () => {
        core.model.mutate(dispatch, {
            type: core.model.StateMutationType.RESET_PLAN,
            data: null,
        });
    },
});

export default connect(mapStateToProps, mapDispatchToProps)(StudioCommandBar);
