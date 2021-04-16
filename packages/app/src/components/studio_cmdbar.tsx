import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../model';
import { connect } from 'react-redux';

import icon_autorun from '../../static/svg/icons/autorun.svg';
import icon_file_download from '../../static/svg/icons/file_download.svg';
import icon_undo from '../../static/svg/icons/undo.svg';

import styles from './cmdbars.module.css';

interface ActionProps {
    onClick: () => void;
}

function Action(props: ActionProps & { icon: string }): React.ReactElement {
    return (
        <div className={styles.cmdbar_cmd} onClick={props.onClick}>
            <svg width="20px" height="20px">
                <use xlinkHref={`${props.icon}#sym`} />
            </svg>
        </div>
    );
}

interface StudioCommandBarProps {
    script: core.model.Script;
    resetPlan: () => void;
}

export class StudioCommandBar extends React.Component<StudioCommandBarProps> {
    _downloadScriptAsFile = this.downloadScriptAsFile.bind(this);

    // Download the script as a file
    downloadScriptAsFile(): void {
        const element = document.createElement('a');
        const file = new Blob([this.props.script.text], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = 'script.dashql';
        document.body.appendChild(element); // Required for this to work in FireFox
        element.click();
    }

    public render(): React.ReactElement {
        return (
            <div className={styles.cmdbar_studio}>
                <div className={styles.cmdbar_cmdset}>
                    <Action icon={icon_autorun} onClick={this.props.resetPlan} />
                    <Action icon={icon_undo} onClick={() => {}} />
                </div>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <Action icon={icon_file_download} onClick={this._downloadScriptAsFile} />
                </div>
            </div>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    script: state.core.script,
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
