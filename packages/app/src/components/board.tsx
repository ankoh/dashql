import * as Immutable from 'immutable';
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
    cards: Immutable.Map<string, core.model.Card>;
    rewriteProgram: (instance: core.model.ProgramInstance) => void;
    editable?: boolean;
    columnCount: number;
    rowHeight: number;
    containerPadding: [number, number];
    elementMargin: [number, number];
};

class BoardLayout extends React.Component<Props> {
    _dirty: boolean;

    constructor(props: Props) {
        super(props);
        this._dirty = false;
    }

    shouldComponentUpdate(nextProps: Props) {
        return nextProps.width != this.props.width || nextProps.cards !== this.props.cards;
    }

    onLayoutChanged(layout: Layout[]) {
        if (!this._dirty) return;
        this._dirty = false;
        const updates: core.edit.EditOperationVariant[] = layout.map(l => ({
            statementID: this.props.cards.get(l.i)!.statementID,
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

    getLayout(data: Immutable.Map<string, core.model.Card>) {
        const l = data.toArray().map(([key, d]) => ({
            i: key,
            x: d.position.column,
            y: d.position.row,
            w: d.position.width || 8,
            h: d.position.height || 4,
        }));
        return l;
    }

    markDirty() {
        this._dirty = true;
    }

    render() {
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
                onDragStart={this.markDirty.bind(this)}
                onResizeStart={this.markDirty.bind(this)}
                onLayoutChange={this.onLayoutChanged.bind(this)}
                layout={this.getLayout(this.props.cards)}
                containerPadding={this.props.containerPadding}
                margin={this.props.elementMargin}
            >
                {Array.from(this.props.cards).map(([k, v]) => (
                    <div key={k}>
                        <CardRenderer card={v} editable={this.props.editable} />
                    </div>
                ))}
            </ReactGrid>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    cards: state.core.planState.cards,
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
