import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import classNames from 'classnames';
import { AppState, Dispatch } from '../../model';
import { connect } from 'react-redux';
import { proto } from '@dashql/core';

import styles from './card_status.module.css';

interface CardStatusProps {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
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
    programStatus: Immutable.List<core.model.StatementStatus>;
    nodes: NodeData[];
}

class CardStatus extends React.Component<CardStatusProps, CardStatusState> {
    constructor(props: CardStatusProps) {
        super(props);
        this.state = CardStatus.rebuild(props);
    }

    protected static rebuild(props: CardStatusProps): CardStatusState {
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
            if (!focus.isSet(idx)) return;
            nodes.push({
                nodeId: idx,
                statementId: idx,
                statementType: stmt.statement_type,
                actionStatus: proto.action.ActionStatusCode.PENDING,
            });
        });
        return CardStatus.updateState(props, {
            program: props.program,
            programStatus: props.programStatus,
            nodes: nodes,
        });
    }

    protected static updateState(props: CardStatusProps, state: CardStatusState): CardStatusState {
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
                    };
            }),
        };
    }

    public static getDerivedStateFromProps(props: CardStatusProps, state: CardStatusState) {
        if (props.program !== state.program) {
            return CardStatus.rebuild(props);
        }
        return CardStatus.updateState(props, state);
    }

    public renderNode(n: NodeData) {
        let color = 'transparent';
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

export default connect(mapStateToProps, mapDispatchToProps)(CardStatus);
