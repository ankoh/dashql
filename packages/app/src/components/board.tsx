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
    shouldComponentUpdate(nextProps: Props) {
        return nextProps.width != this.props.width || nextProps.cards !== this.props.cards;
    }

    onItemLayoutChanged = (
        _layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        _placeholder: Layout,
        _event: MouseEvent,
        _element: HTMLElement,
    ) => {
        const card = this.props.cards.get(oldItem.i)!;
        const stmt = card.statementID;

        const analyzer = this.props.appContext.platform!.analyzer;
        const next = analyzer.editProgram([
            {
                type: core.edit.EditOperationType.VIZ_CHANGE_POSITION,
                statement_id: stmt,
                data: {
                    row: newItem.y,
                    column: newItem.x,
                    width: newItem.w,
                    height: newItem.h,
                },
            },
        ]);
        if (next) {
            this.props.rewriteProgram(next);
        }
    };

    getLayout(data: Immutable.Map<string, core.model.Card>) {
        const l = data.toArray().map(([key, data]) => ({
            i: key,
            x: data.position.column,
            y: data.position.row,
            w: data.position.width || 8,
            h: data.position.height || 4,
        }));
        return l;
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
                onDragStop={this.onItemLayoutChanged}
                onResizeStop={this.onItemLayoutChanged}
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
    cards: state.core.cards,
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
