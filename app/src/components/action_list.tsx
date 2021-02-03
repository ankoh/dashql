import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { SystemCard } from './system_card';
import { ActionStatusIndicator } from './status';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import styles from './action_list.module.css';

function getSetupActionTypeLabel(type: proto.action.SetupActionType) {
    switch (type) {
        case proto.action.SetupActionType.DROP_BLOB:
            return 'Drop Blob';
        case proto.action.SetupActionType.DROP_TABLE:
            return 'Drop Table';
        case proto.action.SetupActionType.DROP_VIEW:
            return 'Drop View';
        case proto.action.SetupActionType.DROP_VIZ:
            return 'Drop Viz';
        case proto.action.SetupActionType.IMPORT_BLOB:
            return 'Import Blob';
        case proto.action.SetupActionType.IMPORT_TABLE:
            return 'Import Table';
        case proto.action.SetupActionType.IMPORT_VIEW:
            return 'Import View';
        case proto.action.SetupActionType.IMPORT_VIZ:
            return 'Import Viz';
        default:
            return '?';
    }
}

function getProgramActionTypeLabel(type: proto.action.ProgramActionType) {
    switch (type) {
        case proto.action.ProgramActionType.EXTRACT_CSV:
            return 'Extract CSV';
        case proto.action.ProgramActionType.EXTRACT_JSON:
            return 'Extract JSON';
        case proto.action.ProgramActionType.LOAD_FILE:
            return 'Load File';
        case proto.action.ProgramActionType.LOAD_HTTP:
            return 'Load HTTP';
        case proto.action.ProgramActionType.PARAMETER:
            return 'Define Parameter';
        case proto.action.ProgramActionType.CREATE_TABLE:
            return 'Create Table';
        case proto.action.ProgramActionType.MODIFY_TABLE:
            return 'Modify Table';
        case proto.action.ProgramActionType.UNNAMED_SELECT:
            return 'Select';
        case proto.action.ProgramActionType.CREATE_VIEW:
            return 'Create View';
        case proto.action.ProgramActionType.CREATE_VIZ:
            return 'Create Viz';
        case proto.action.ProgramActionType.UPDATE_VIZ:
            return 'Update Viz';
        default:
            return '?';
    }
}

interface Props {
    className?: string;
    plan: core.model.Plan | null;
    planActions: Immutable.Map<core.model.ActionID, core.model.Action>;
    onClose: () => void;
}

class ActionList extends React.Component<Props> {
    public renderActions(plan: core.model.Plan) {
        let setup_actions: JSX.Element[] = [];
        let program_actions: JSX.Element[] = [];
        plan.iterateSetupActionsReverse((i: number, o: proto.action.SetupAction) => {
            const actionId = core.model.buildActionID(i, core.model.ActionClass.SetupAction);
            const actionInfo = this.props.planActions.get(actionId);
            const status = actionInfo?.statusCode || proto.action.ActionStatusCode.NONE;
            setup_actions.push(
                <div key={i} className={styles.action}>
                    <div className={styles.action_expand}>
                        <div className={styles.action_expand_icon}>
                            <ChevronRightIcon width="20px" height="20px" />
                        </div>
                    </div>
                    <div className={styles.action_status}>
                        <ActionStatusIndicator width="14px" height="14px" status={status} />
                    </div>
                    <div className={styles.action_type}>{getSetupActionTypeLabel(o.actionType())}</div>
                    <div className={styles.action_duration}>0 ms</div>
                </div>,
            );
        });
        plan.iterateProgramActions((i: number, o: proto.action.ProgramAction) => {
            const actionId = core.model.buildActionID(i, core.model.ActionClass.ProgramAction);
            const actionInfo = this.props.planActions.get(actionId);
            const status = actionInfo?.statusCode || proto.action.ActionStatusCode.NONE;
            program_actions.push(
                <div key={i} className={styles.action}>
                    <div className={styles.action_expand}>
                        <div className={styles.action_expand_icon}>
                            <ChevronRightIcon width="20px" height="20px" />
                        </div>
                    </div>
                    <div className={styles.action_status}>
                        <ActionStatusIndicator width="14px" height="14px" status={status} />
                    </div>
                    <div className={styles.action_type}>{getProgramActionTypeLabel(o.actionType())}</div>
                    <div className={styles.action_duration}>0 ms</div>
                </div>,
            );
        });
        return (
            <div className={styles.actions}>
                {setup_actions.length > 0 && <div className={styles.setup_actions}>{setup_actions}</div>}
                <div className={styles.program_actions}>{program_actions}</div>
            </div>
        );
    }

    public render() {
        return (
            <SystemCard title="Action" subtitle="started 20 ms ago" onClose={this.props.onClose}>
                {this.props.plan && this.renderActions(this.props.plan)}
            </SystemCard>
        );
    }

    componentDidMount() {}

    componentDidUpdate(_prev: Readonly<Props>): void {}
}

const mapStateToProps = (state: AppState) => ({
    plan: state.core.plan,
    planActions: state.core.planActions,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ActionList);
