import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../model';
import { proto } from '@dashql/core';
import { useSelector } from 'react-redux';
import { SystemCard } from './system_card';
import { ActionStatusIndicator } from './status';
import styles from './action_list.module.css';

function getSetupActionTypeLabel(type: proto.action.SetupActionType) {
    switch (type) {
        case proto.action.SetupActionType.DROP_BLOB:
            return 'DROP BLOB';
        case proto.action.SetupActionType.DROP_TABLE:
            return 'DROP TABLE';
        case proto.action.SetupActionType.DROP_VIEW:
            return 'DROP VIEW';
        case proto.action.SetupActionType.DROP_VIZ:
            return 'DROP VIZ';
        case proto.action.SetupActionType.IMPORT_BLOB:
            return 'IMPORT BLOB';
        case proto.action.SetupActionType.IMPORT_TABLE:
            return 'IMPORT TABLE';
        case proto.action.SetupActionType.IMPORT_VIEW:
            return 'IMPORT VIEW';
        case proto.action.SetupActionType.IMPORT_VIZ:
            return 'IMPORT VIZ';
        default:
            return '?';
    }
}

function getProgramActionTypeLabel(type: proto.action.ProgramActionType) {
    switch (type) {
        case proto.action.ProgramActionType.LOAD:
            return 'LOAD';
        case proto.action.ProgramActionType.FETCH:
            return 'FETCH';
        case proto.action.ProgramActionType.INPUT:
            return 'INPUT';
        case proto.action.ProgramActionType.CREATE_TABLE:
            return 'CREATE TABLE';
        case proto.action.ProgramActionType.MODIFY_TABLE:
            return 'MODIFY TABLE';
        case proto.action.ProgramActionType.CREATE_VIEW:
            return 'CREATE VIEW';
        case proto.action.ProgramActionType.CREATE_VIZ:
            return 'CREATE VIZ';
        case proto.action.ProgramActionType.UPDATE_VIZ:
            return 'UPDATE VIZ';
        default:
            return '?';
    }
}

interface Props {
    className?: string;
    onClose: () => void;
}

const renderActions = (
    plan: core.model.Plan,
    planActions: Immutable.Map<core.model.ActionHandle, core.model.Action>,
) => {
    const setup_actions: JSX.Element[] = [];
    const program_actions: JSX.Element[] = [];
    plan.iterateSetupActionsReverse((i: number, o: proto.action.SetupAction) => {
        const actionId = core.model.buildActionHandle(i, proto.action.ActionClass.SETUP_ACTION);
        const actionInfo = planActions.get(actionId);
        const status = actionInfo?.statusCode || proto.action.ActionStatusCode.PENDING;
        setup_actions.push(
            <div key={i} className={styles.action}>
                <div className={styles.action_status}>
                    <ActionStatusIndicator width="12px" height="12px" status={status} />
                </div>
                <div className={styles.action_type}>{getSetupActionTypeLabel(o.actionType())}</div>
                <div className={styles.action_duration}>0 ms</div>
            </div>,
        );
    });
    plan.iterateProgramActions((i: number, o: proto.action.ProgramAction) => {
        const actionId = core.model.buildActionHandle(i, proto.action.ActionClass.PROGRAM_ACTION);
        const actionInfo = planActions.get(actionId);
        const status = actionInfo?.statusCode || proto.action.ActionStatusCode.PENDING;
        program_actions.push(
            <div key={i} className={styles.action}>
                <div className={styles.action_status}>
                    <ActionStatusIndicator width="12px" height="12px" status={status} />
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
};

export const ActionList: React.FC<Props> = (props: Props) => {
    const { plan, actions } = useSelector((state: model.AppState) => ({
        plan: state.core.plan,
        actions: state.core.planState.actions,
    }));
    return (
        <SystemCard title="Action" onClose={props.onClose} className={props.className}>
            {plan && renderActions(plan, actions)}
        </SystemCard>
    );
};
