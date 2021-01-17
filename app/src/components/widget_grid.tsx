import Immutable from 'immutable';
import * as core from '@dashql/core';
import * as React from 'react';
import * as model from '../model';
import ReactGrid from 'react-grid-layout';
import { ItemCallback, Layout } from 'react-grid-layout';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import { withAutoSizer } from '../util/autosizer';
import TableChart from './widgets/table_chart';

import './widget_grid.module.css';

type Props = {
    appContext: IAppContext;
    width: number;
    height: number;

    vizData: Map<string, core.model.VizInfo>;
    rewriteProgram: (instance: core.model.ProgramInstance) => void;
};

function getLayout(data: core.model.VizInfo) {
    const pos = data.spec.data.position;
    return {
        x: pos.x,
        y: pos.y,
        w: pos.width,
        h: pos.height,
    };
}

class WidgetGrid extends React.Component<Props> {
    _onItemLayoutChanged = this.onItemLayoutChanged.bind(this);

    renderWidget(data: core.model.VizInfo) {
        switch (data.spec.type) {
            case core.model.VizSpecType.TABLE:
                return <TableChart viz={data} />;
            default:
                return <div />;
        }
    }

    shouldComponentUpdate(nextProps: Props, _nextState: any) {
        const prev = this.props.vizData;
        const next = nextProps.vizData;
        let equal = prev.size == next.size;
        for (let [k, v] of next) {
            const p = prev.get(k);
            equal = equal && v === p;
        }
        return !equal;
    }

    onItemLayoutChanged(
        _layout: Layout[],
        oldItem: Layout,
        newItem: Layout,
        _placeholder: Layout,
        _event: MouseEvent,
        _element: HTMLElement,
    ) {
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
    }

    render() {
        return (
            <ReactGrid
                resizeHandles={['se']}
                cols={12}
                width={this.props.width}
                rowHeight={50}
                compactType={null}
                onDragStop={this._onItemLayoutChanged}
                onResizeStop={this._onItemLayoutChanged}
            >
                {Array.from(this.props.vizData).map(([k, v]) => (
                    <div key={k} data-grid={getLayout(v)}>
                        {this.renderWidget(v)}
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
            .map(([k, v]) => [k, v as core.model.VizInfo]) as [string, core.model.VizInfo][],
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

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(withAutoSizer(WidgetGrid)));
