import Immutable from 'immutable';
import * as core from '@dashql/core';
import * as React from 'react';
import * as model from '../model';
import ReactGrid from 'react-grid-layout';
import { Layout } from 'react-grid-layout';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import { CardRenderer } from './card';

import './board.module.css';

type Props = {
    appContext: IAppContext;
    className?: string;
    width: number;
    planState: core.model.PlanState;
    editable?: boolean;
    columnCount: number;
    rowHeight: number;
    containerPadding: [number, number];
    elementMargin: [number, number];

    rewriteProgram: (instance: core.model.ProgramInstance) => void;
};

type State = {
    planObjects: Immutable.Map<core.model.PlanObjectID, core.model.PlanObject>;
    layout: LayoutElement[];
};

interface LayoutElement {
    card: core.model.CardSpecification;
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

class BoardLayout extends React.Component<Props, State> {
    _dirty: boolean;

    _markDirty = this.markDirty.bind(this);
    _onLayoutChanged = this.onLayoutChanged.bind(this);

    constructor(props: Props) {
        super(props);
        this._dirty = false;
        this.state = BoardLayout.getDerivedStateFromProps(props);
    }

    shouldComponentUpdate(nextProps: Props) {
        return nextProps.width != this.props.width || nextProps.planState !== this.props.planState;
    }

    static getDerivedStateFromProps(props: Props, prevState?: State): State {
        if (props.planState.objects == prevState?.planObjects) {
            return prevState;
        }
        const els: LayoutElement[] = [];
        core.model.forEachCard(props.planState, (card, i) => {
            els.push({
                card: card,
                i: card.objectId.toString(),
                x: card.position.column,
                y: card.position.row,
                w: card.position.width || 12,
                h: card.position.height || 4,
            });
        });
        return {
            planObjects: props.planState.objects,
            layout: els,
        };
    }

    onLayoutChanged(layout: Layout[]) {
        if (!this._dirty) return;
        this._dirty = false;
        const updates: core.edit.EditOperationVariant[] = layout.map(l => ({
            statementID: (l as LayoutElement).card.statementID,
            type: core.edit.EditOperationType.UPDATE_CARD_POSITION,
            data: {
                position: {
                    row: l.y,
                    column: l.x,
                    width: l.w,
                    height: l.h,
                },
            },
        }));
        const analyzer = this.props.appContext.platform!.analyzer;
        const next = analyzer.editProgram(updates);
        if (next) {
            this.props.rewriteProgram(next);
        }
    }

    markDirty() {
        this._dirty = true;
    }

    render() {
        const els: React.ReactElement[] = [];
        for (const l of this.state.layout) {
            if (!l.card.visible) continue;
            els.push(
                <div key={l.card.objectId}>
                    <CardRenderer card={l.card} editable={this.props.editable} />
                </div>,
            );
        }
        return (
            <ReactGrid
                className={this.props.className}
                resizeHandles={['se']}
                width={this.props.width}
                cols={this.props.columnCount}
                rowHeight={this.props.rowHeight}
                compactType={null}
                isDraggable={!!this.props.editable}
                isResizable={!!this.props.editable}
                onDragStart={this._markDirty}
                onResizeStart={this._markDirty}
                onLayoutChange={this._onLayoutChanged}
                layout={this.state.layout}
                containerPadding={this.props.containerPadding}
                margin={this.props.elementMargin}
            >
                {els}
            </ReactGrid>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    planState: state.core.planState,
});

const mapDispatchToProps = (dispatch: model.Dispatch) => ({
    rewriteProgram: (instance: core.model.ProgramInstance) => {
        model.mutate(dispatch, {
            type: core.model.StateMutationType.REWRITE_PROGRAM,
            data: instance,
        });
    },
});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(BoardLayout));
