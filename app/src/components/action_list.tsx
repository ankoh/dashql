import * as React from "react";
import * as core from "@dashql/core";
import { proto } from "@dashql/core";
import { AppState, Dispatch } from '../store';
import { connect } from 'react-redux';
import { ActionStatusSpinner } from './spinners';
import { ChevronRightIcon } from '../svg/icons';
import styles from './action_list.module.css';

interface Props {
    className?: string
    plan: core.Plan | null;
}

interface State {
}

class ActionList extends React.Component<Props, State> {

    public renderActions(plan: core.Plan)  {
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
            const status = o.actionStatus();
            program_actions.push(
                <div key={i} className={styles.action}>
                    <div className={styles.action_expand}>
                        <div className={styles.action_expand_icon}>
                            <ChevronRightIcon width="20px" height="20px" />
                        </div>
                    </div>
                    <div className={styles.action_status}>
                        <ActionStatusSpinner width="16px" height="16px" status={status} />
                    </div>
                    <div className={styles.action_type}>
                        {proto.action.ProgramActionType[o.actionType()]}
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
                    Actions
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
    plan: state.plan
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(ActionList);

