import * as React from "react";
import * as core from "@dashql/core";
import { proto } from "@dashql/core";
import { AppState, Dispatch } from '../store';
import { connect } from 'react-redux';
import styles from './task_list.module.css';

interface Props {
    className?: string
    plan: core.Plan | null;
}

class TaskList extends React.Component<Props> {

    public renderActions(plan: core.Plan)  {
        let setup_actions: JSX.Element[] = [];
        let program_actions: JSX.Element[] = [];
        plan.iterateSetupActions((i: number, o: proto.action.SetupAction) => {
            console.log("setup[" + i + "] " + o.targetNameQualified());
            setup_actions.push(
                <div key={i}>
                    {o.targetNameShort()}
                </div>
            );
        });
        plan.iterateProgramActions((i: number, o: proto.action.ProgramAction) => {
            console.log("program[" + i + "] " + o.targetNameQualified());
            program_actions.push(
                <div key={i}>
                    {o.targetNameShort()}
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
            <div className={styles.task_list}>
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

export default connect(mapStateToProps, mapDispatchToProps)(TaskList);

