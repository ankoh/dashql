import Immutable from 'immutable';
import * as core from '@dashql/core';
import * as React from 'react';
import * as model from '../model';
import ReactGrid from 'react-grid-layout';
import { connect } from 'react-redux';
import { withAutoSizer } from '../util/autosizer';
import TableChart from './widgets/table_chart';

import styles from './widget_grid.module.css';
import './widget_grid.raw.css';

type Props = {
    width: number;
    height: number;

    vizData: [string, core.model.VizInfo][];
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
        let equal = prev.length == next.length;
        let ht = new Map<string, core.model.VizInfo>(prev);
        for (let [k, v] of next) {
            const p = ht.get(k);
            equal = equal && (v === p);
        }
        return !equal;
    }

    render() {
        return (
            <ReactGrid
                resizeHandles={['se']}
                cols={12}
                width={this.props.width}
                rowHeight={50}
                compactType={null}
                onDrag={console.log.bind(console)}
            >
                {this.props.vizData.map(([k, v]) => (
                    <div key={k} data-grid={getLayout(v)}>
                        {this.renderWidget(v)}
                    </div>
                ))}
            </ReactGrid>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    vizData: state.core.planObjects
        .filter(o => o.objectType == core.model.PlanObjectType.VIZ_INFO)
        .toArray()
        .map(([k, v]) => [k, v as core.model.VizInfo]) as [string, core.model.VizInfo][],
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAutoSizer(WidgetGrid));
