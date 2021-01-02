import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../model';
import { AutoRunIcon, CloudUploadIcon, DocumentDownloadIcon, IIconProps, PlayIcon, UndoIcon } from '../svg/icons';
import { connect } from 'react-redux';

import styles from './studio.module.css';

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

const PlayAction = createAction(PlayIcon);
const UndoAction = createAction(UndoIcon);
const AutoRunAction = createAction(AutoRunIcon);
const DocumentDownloadAction = createAction(DocumentDownloadIcon);
const CloudUploadAction = createAction(CloudUploadIcon);

interface ProgramCommandBarProps {
    resetPlan: () => void,
}

export class ProgramCommandBar extends React.Component<ProgramCommandBarProps> {
    public render() {
        return (
            <div className={styles.cmdbar_program}>
                <div className={styles.cmdbar_cmdset}>
                    <PlayAction onClick={() => {}} />
                    <AutoRunAction onClick={() => this.props.resetPlan()} />
                    <UndoAction onClick={() => {}} />
                </div>
                <div className={styles.cmdbar_cmdset} />
                <div className={styles.cmdbar_cmdset}>
                    <DocumentDownloadAction onClick={() => {}} />
                    <CloudUploadAction onClick={() => {}} />
                </div>
            </div>
        );
    }
}

const mapStateToProps = (_state: model.AppState) => ({});

const mapDispatchToProps = (dispatch: model.Dispatch) => ({
    resetPlan: () => {
        core.model.mutate(dispatch, {
            type: core.model.StateMutationType.RESET_PLAN,
            data: null,
        });
    },
});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramCommandBar);
