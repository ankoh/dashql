import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import classNames from 'classnames';
import { proto } from '@dashql/core';
import { useSelector } from 'react-redux';

import styles from './card_status.module.css';

interface CardStatusProps {
    className?: string;
    card: core.model.CardSpecification;
}

interface NodeData {
    nodeId: number;
    statementId: number;
    statementType: proto.syntax.StatementType;
    actionStatus: proto.action.ActionStatusCode | null;
}

interface CardStatusState {
    program: core.model.Program | null;
    status: Immutable.List<core.model.StatementStatus>;
    nodes: NodeData[];
}

const updateState = (state: CardStatusState): CardStatusState => ({
    ...state,
    nodes: state.nodes.map(n => {
        const s = state.status.get(n.statementId)!.status;
        if (n.actionStatus == s) {
            return n;
        } else
            return {
                ...n,
                statementType: n.statementType,
                actionStatus: s,
            };
    }),
});

const rebuild = (
    props: CardStatusProps,
    program: core.model.Program | null,
    status: Immutable.List<core.model.StatementStatus>,
): CardStatusState => {
    if (!program) {
        return {
            program: null,
            status: Immutable.List<core.model.StatementStatus>(),
            nodes: [],
        };
    }

    // Collect all transitive dependencies
    const focus = new core.utils.NativeBitmap(program.buffer.statementsLength());
    const depDFS: number[] = [];
    const depMapping = program.statementDependencies;
    focus.set(props.card.statementID);
    depDFS.push(props.card.statementID);
    while (depDFS.length > 0) {
        const top = depDFS.pop()!;
        const deps = depMapping.get(top);
        if (!deps) continue;
        for (const dep of deps) {
            if (!focus.isSet(dep)) {
                focus.set(dep);
                depDFS.push(dep);
            }
        }
    }

    // We use dagre to do the layouting and render the graph with react-flow afterwards
    const nodes: NodeData[] = [];
    program.iterateStatements((idx: number, stmt: core.model.Statement) => {
        if (!focus.isSet(idx)) return;
        nodes.push({
            nodeId: idx,
            statementId: idx,
            statementType: stmt.statement_type,
            actionStatus: proto.action.ActionStatusCode.PENDING,
        });
    });
    return updateState({
        program: program,
        status: status,
        nodes: nodes,
    });
};

export const CardStatus: React.FC<CardStatusProps> = (props: CardStatusProps) => {
    const [program, status]: [core.model.Program | null, Immutable.List<core.model.StatementStatus>] = useSelector(
        (state: model.AppState) => [state.core.program, state.core.planState.status],
    );
    const [state, setState] = React.useState<CardStatusState>(() => rebuild(props, program, status));
    if (program !== state.program) {
        setState(rebuild(props, program, status));
    }
    const renderNode = (n: NodeData) => {
        let color = 'transparent';
        switch (n.actionStatus!) {
            case proto.action.ActionStatusCode.BLOCKED:
                color = 'rgb(219, 171, 10)';
                break;
            case proto.action.ActionStatusCode.COMPLETED:
                color = 'rgb(83, 164, 81)';
                break;
            case proto.action.ActionStatusCode.FAILED:
                color = 'rgb(187, 54, 56)';
                break;
            case proto.action.ActionStatusCode.RUNNING:
                color = 'rgb(219, 171, 10)';
                break;
            case proto.action.ActionStatusCode.PENDING:
                color = 'rgb(160, 160, 160)';
                break;
        }
        return <div key={n.nodeId} className={styles.node} style={{ backgroundColor: color }} />;
    };
    if (program == null) {
        return <div />;
    }
    return (
        <div className={classNames(styles.container, props.className)}>
            <div className={styles.node_group}>{state.nodes.map(n => renderNode(n))}</div>
        </div>
    );
};
