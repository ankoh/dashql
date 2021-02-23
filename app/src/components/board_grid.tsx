import * as core from '@dashql/core';
import * as React from 'react';
import * as model from '../model';
import ReactGrid from 'react-grid-layout';
import { Layout } from 'react-grid-layout';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import { withAutoSizer } from '../util/autosizer';
import TableChart from './widgets/table_chart';

import './board_grid.module.css';

type Props = {
    appContext: IAppContext;
    width: number;
    height: number;

    vizData: Map<string, core.model.VizInfo>;
    rewriteProgram: (instance: core.model.ProgramInstance) => void;
};

class BoardGrid extends React.Component<Props> {
    renderViz(data: core.model.VizInfo) {
        return <TableChart viz={data} />;
    }

    shouldComponentUpdate(nextProps: Props) {
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
                    row: newItem.x,
                    column: newItem.y,
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
            x: data.spec.position.column,
            y: data.spec.position.row,
            w: data.spec.position.width || 8,
            h: data.spec.position.height || 4,
        }));
        return l;
    }

    render() {
        return (
            <ReactGrid
                resizeHandles={['se']}
                cols={12}
                width={this.props.width}
                rowHeight={50}
                compactType={null}
                onDragStop={this.onItemLayoutChanged}
                onResizeStop={this.onItemLayoutChanged}
                layout={this.getLayout(this.props.vizData)}
            >
                {Array.from(this.props.vizData).map(([k, v]) => (
                    <div key={k}>{this.renderViz(v)}</div>
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

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(withAutoSizer(BoardGrid)));
