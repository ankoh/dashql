import * as React from "react";
import * as core from "@dashql/core";
import { proto } from "@dashql/core";
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import { ActionStatusSpinner } from './spinners';
import { ChevronRightIcon, CloseIcon } from '../svg/icons';
import styles from './action_list.module.css';

function getProgramActionTypeLabel(type: proto.action.ProgramActionType) {
    switch (type) {
        case proto.action.ProgramActionType.EXTRACT_CSV:
            return "Extract CSV";
        case proto.action.ProgramActionType.EXTRACT_JSON:
            return "Extract JSON";
        case proto.action.ProgramActionType.LOAD_FILE:
            return "Load File";
        case proto.action.ProgramActionType.LOAD_HTTP:
            return "Load HTTP";
        case proto.action.ProgramActionType.PARAMETER:
            return "Define Parameter";
        case proto.action.ProgramActionType.TABLE_CREATE:
            return "Create Table";
        case proto.action.ProgramActionType.TABLE_MODIFY:
            return "Modify Table";
        case proto.action.ProgramActionType.VIEW_CREATE:
            return "Create View";
        case proto.action.ProgramActionType.VIZ_CREATE:
            return "Create Viz";
        case proto.action.ProgramActionType.VIZ_UPDATE:
            return "Update Viz";
        default:
            return "?";
    }
}

interface Props {
    className?: string
    plan: core.model.Plan | null;
    close: () => void;
}

interface State {
}

class ActionList extends React.Component<Props, State> {

    public renderActions(plan: core.model.Plan)  {
        let setup_actions: JSX.Element[] = [];
        let program_actions: JSX.Element[] = [];
        plan.iterateSetupActions((i: number, o: proto.action.SetupAction) => {
            setup_actions.push(
                <div key={i} className={styles.action}>
                    {proto.action.SetupActionType[o.actionType()]}
                </div>
            );
        });
        plan.iterateProgramActions((i: number, o: proto.action.ProgramAction) => {
            const status = o.actionStatusCode();
            program_actions.push(
                <div key={i} className={styles.action}>
                    <div className={styles.action_expand}>
                        <div className={styles.action_expand_icon}>
                            <ChevronRightIcon width="20px" height="20px" />
                        </div>
                    </div>
                    <div className={styles.action_status}>
                        <ActionStatusSpinner width="14px" height="14px" status={status} />
                    </div>
                    <div className={styles.action_type}>
                        {getProgramActionTypeLabel(o.actionType())}
                    </div>
                    <div className={styles.action_duration}>
                        0 ms
                    </div>
                </div>
            );
        });
        return (
            <div className={styles.actions}>
                <div className={styles.setup_actions}>
                    {setup_actions}
                </div>
                <div className={styles.program_actions}>
                    {program_actions}
                </div>
            </div>
        );
    }

    public render() {
        return (
            <div className={styles.action_list_panel}>
                <div className={styles.action_header}>
                    <div className={styles.action_header_title}>
                        Actions
                    </div>
                    <div className={styles.action_header_subtitle}>
                        started 20 ms ago
                    </div>
                    <div className={styles.action_close} onClick={this.props.close}>
                        <CloseIcon width="20px" height="20px" />
                    </div>
                </div>
                {this.props.plan && this.renderActions(this.props.plan)}
            </div>
        );
    }

    componentDidMount() {
    }

    componentDidUpdate(_prev: Readonly<Props>): void {
    }

}

const mapStateToProps = (state: AppState) => ({
    plan: state.core.plan
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(ActionList);

