import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import { proto } from '@dashql/core';

import styles from './card_status.module.css';

interface CardStatusProps {
    className?: string;
    card: core.model.CardSpecification;
}

interface NodeData {
    nodeId: number;
    statementId: number;
    statementType: proto.syntax.StatementType;
    taskStatus: proto.task.TaskStatusCode | null;
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
        if (n.taskStatus == s) {
            return n;
        } else
            return {
                ...n,
                statementType: n.statementType,
                taskStatus: s,
            };
    }),
});

const rebuild = (
    card: core.model.CardSpecification,
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
    focus.set(card.statementID);
    depDFS.push(card.statementID);
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
            taskStatus: proto.task.TaskStatusCode.PENDING,
        });
    });
    return updateState({
        program: program,
        status: status,
        nodes: nodes,
    });
};

export const CardStatus: React.FC<CardStatusProps> = (props: CardStatusProps) => {
    const { program } = core.model.useProgramContext();
    const { statementStatus } = core.model.usePlanContext();

    const state = React.useMemo<CardStatusState>(
        () => rebuild(props.card, program, statementStatus),
        [props.card, program, statementStatus],
    );
    const renderNode = (n: NodeData) => {
        let color = 'transparent';
        switch (n.taskStatus!) {
            case proto.task.TaskStatusCode.BLOCKED:
                color = 'rgb(219, 171, 10)';
                break;
            case proto.task.TaskStatusCode.COMPLETED:
                color = 'rgb(83, 164, 81)';
                break;
            case proto.task.TaskStatusCode.FAILED:
                color = 'rgb(187, 54, 56)';
                break;
            case proto.task.TaskStatusCode.RUNNING:
                color = 'rgb(219, 171, 10)';
                break;
            case proto.task.TaskStatusCode.PENDING:
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
