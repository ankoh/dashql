import * as core from '@dashql/core';
import * as React from 'react';
import * as model from '../model';
import ReactGrid from 'react-grid-layout';
import { Layout } from 'react-grid-layout';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import VizComponent from './viz/viz_component';

import './board.module.css';

type Props = {
    appContext: IAppContext;
    className?: string;
    width: number;
    vizData: Map<string, core.model.VizInfo>;
    rewriteProgram: (instance: core.model.ProgramInstance) => void;
    editable?: boolean;
    columnCount: number;
    rowHeight: number;
    containerPadding: [number, number];
    elementMargin: [number, number];
};

class BoardLayout extends React.Component<Props> {
    shouldComponentUpdate(nextProps: Props) {
        if (nextProps.width != this.props.width) return true;
        const prev = this.props.vizData;
        const next = nextProps.vizData;
        let equal = prev.size == next.size;
        for (let [k, v] of next) {
            const p = prev.get(k);
            equal = equal && v === p;
        }
        return !equal;
    }

    onItemLayoutChanged = (
        _layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        _placeholder: Layout,
        _event: MouseEvent,
        _element: HTMLElement,
    ) => {
        const info = this.props.vizData.get(oldItem.i)!;
        const stmt = info.currentStatementId;

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

    getLayout(data: Map<string, core.model.VizInfo>) {
        const l = Array.from(data).map(([key, data]) => ({
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
                layout={this.getLayout(this.props.vizData)}
                containerPadding={this.props.containerPadding}
                margin={this.props.elementMargin}
            >
                {Array.from(this.props.vizData).map(([k, v]) => (
                    <div key={k}>
                        <VizComponent vizInfo={v} editable={this.props.editable} />
                    </div>
                ))}
            </ReactGrid>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    vizData: new Map(
        state.core.planObjects
            .filter(o => o.objectType == core.model.PlanObjectType.VIZ_INFO)
            .toArray()
            .sort(
                (l, r) =>
                    (l[1] as core.model.VizInfo).currentStatementId - (r[1] as core.model.VizInfo).currentStatementId,
            )
            .map(([k, v]) => [k, v as core.model.VizInfo]),
    ),
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
