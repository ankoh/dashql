import * as React from 'react';
import * as model from '../../model';
import * as utils from '../../utils';
import classNames from 'classnames';
import * as proto from '@dashql/dashql-proto';

import styles from './card_status.module.css';
import { useWorkflowSessionState, WorkflowSessionState } from '../../backend/workflow_session';
import { TaskStatusCode } from '../../model/task_status';

interface CardStatusProps {
    className?: string;
    statementId: number;
}

interface Node {
    statementId: number;
    statementType: proto.StatementType;
    taskStatus: TaskStatusCode | null;
}

const rebuild = (originId: number, sessionState: WorkflowSessionState | null): Node[] => {
    const program = sessionState.program;
    const dependsOn = sessionState.statementDependsOn;
    if (!program || !dependsOn) {
        return [];
    }

    // Collect all transitive dependencies
    const focus = new utils.NativeBitmap(program.ast.statementsLength());
    const depDFS: number[] = [];
    focus.set(originId);
    depDFS.push(originId);
    while (depDFS.length > 0) {
        const top = depDFS.pop()!;
        const deps = dependsOn.get(top) ?? [];
        if (!deps) continue;
        console.log(deps);
        for (const dep of deps) {
            if (!focus.isSet(dep)) {
                focus.set(dep);
                depDFS.push(dep);
            }
        }
    }

    // Determine the nodes
    const nodes: Node[] = [];
    program.iterateStatements((idx: number, stmt: model.Statement) => {
        if (!focus.isSet(idx)) return;
        nodes.push({
            statementId: idx,
            statementType: stmt.statement_type,
            taskStatus: sessionState.statusByStatement.get(idx)?.status ?? TaskStatusCode.Pending,
        });
    });
    console.log({
        originId: originId,
        dependsOn: dependsOn,
        nodes: nodes,
    });
    return nodes;
};

export const CardStatus: React.FC<CardStatusProps> = (props: CardStatusProps) => {
    const sessionState = useWorkflowSessionState();
    const nodes = React.useMemo<Node[]>(
        () => rebuild(props.statementId, sessionState),
        [props.statementId, sessionState.program, sessionState.statusByTask, sessionState.statusByStatement],
    );
    if (sessionState == null) {
        return <div />;
    }
    const renderNode = (n: Node) => {
        let color = 'transparent';
        switch (n.taskStatus!) {
            case TaskStatusCode.Blocked:
                color = 'rgb(219, 171, 10)';
                break;
            case TaskStatusCode.Completed:
                color = 'rgb(83, 164, 81)';
                break;
            case TaskStatusCode.Failed:
                color = 'rgb(187, 54, 56)';
                break;
            case TaskStatusCode.Preparing:
            case TaskStatusCode.Executing:
            case TaskStatusCode.Prepared:
                color = 'rgb(219, 171, 10)';
                break;
            case TaskStatusCode.Pending:
                color = 'rgb(160, 160, 160)';
                break;
        }
        return <div key={n.statementId} className={styles.node} style={{ backgroundColor: color }} />;
    };
    return (
        <div className={classNames(styles.container, props.className)}>
            <div className={styles.node_group}>{nodes.map(n => renderNode(n))}</div>
        </div>
    );
};
