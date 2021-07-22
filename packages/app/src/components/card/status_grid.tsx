import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import { AppState, Dispatch } from '../../model';
import { connect } from 'react-redux';
import { proto } from '@dashql/core';

import styles from './status_grid.module.css';

interface StatusGridProps {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    className?: string;
    card: core.model.Card;
}

interface NodeData {
    nodeId: number;
    statementId: number;
    statementType: proto.syntax.StatementType;
    actionStatus: proto.action.ActionStatusCode | null;
    focused: boolean;
}

interface StatusGridState {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    nodes: NodeData[];
}

class StatusGrid extends React.Component<StatusGridProps, StatusGridState> {
    constructor(props: StatusGridProps) {
        super(props);
        this.state = StatusGrid.rebuild(props);
    }

    protected static rebuild(props: StatusGridProps): StatusGridState {
        if (!props.program) {
            return {
                program: null,
                programStatus: Immutable.List<core.model.StatementStatus>(),
                nodes: [],
            };
        }

        // Collect all transitive dependencies
        const focus = new core.utils.NativeBitmap(props.program.buffer.statementsLength());
        const depDFS: number[] = [];
        const depMapping = props.program.statementDependencies;
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
        props.program.iterateStatements((idx: number, stmt: core.model.Statement) => {
            nodes.push({
                nodeId: idx,
                statementId: idx,
                statementType: stmt.statement_type,
                actionStatus: proto.action.ActionStatusCode.PENDING,
                focused: focus.isSet(idx),
            });
        });
        return StatusGrid.updateState(props, {
            program: props.program,
            programStatus: props.programStatus,
            nodes: nodes,
        });
    }

    protected static updateState(props: StatusGridProps, state: StatusGridState): StatusGridState {
        return {
            ...state,
            nodes: state.nodes.map(n => {
                const s = props.programStatus.get(n.statementId)!.status;
                if (n.actionStatus == s) {
                    return n;
                } else
                    return {
                        ...n,
                        statementType: n.statementType,
                        actionStatus: s,
                        focused: n.focused,
                    };
            }),
        };
    }

    public static getDerivedStateFromProps(props: StatusGridProps, state: StatusGridState) {
        if (props.program !== state.program) {
            return StatusGrid.rebuild(props);
        }
        return StatusGrid.updateState(props, state);
    }

    public renderNode(n: NodeData) {
        let color = 'transparent';
        if (n.focused) {
            switch (n.actionStatus!) {
                case proto.action.ActionStatusCode.BLOCKED:
                    color = 'rgb(213, 172, 59)';
                    break;
                case proto.action.ActionStatusCode.COMPLETED:
                    color = 'rgb(30, 30, 30)';
                    break;
                case proto.action.ActionStatusCode.FAILED:
                    color = 'rgb(187, 54, 56)';
                    break;
                case proto.action.ActionStatusCode.RUNNING:
                    color = 'rgb(83, 164, 81)';
                    break;
                case proto.action.ActionStatusCode.PENDING:
                    color = 'rgb(160, 160, 160)';
                    break;
            }
        }
        return <div key={n.nodeId} className={styles.node} style={{ backgroundColor: color }} />;
    }

    public render() {
        if (this.props.program == null) {
            return <div />;
        }
        return (
            <div className={classNames(styles.container, this.props.className)}>
                <div className={styles.node_group}>{this.state.nodes.map(n => this.renderNode(n))}</div>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    program: state.core.plan?.program || null,
    programStatus: state.core.planState.status,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(StatusGrid);
