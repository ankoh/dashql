import * as Immutable from 'immutable';
import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@dashql/proto';
import { isPresent } from '../../util/functional';
import * as Store from '../../store';
import VizCard from './viz_card';
import GridElement from './grid_element';

import styles from './viz_grid.module.scss';

/// Viz grid properties
interface IVizGridProps {
    module: proto.tql.Module;
    queryResults: Immutable.Map<string, proto.engine.QueryResult>;

    sizeClass: Store.SizeClass;
}

/// A viz grid state
interface IVizGridState {
    visualizations: {
        statement: proto.tql.VizStatement;
        data: proto.engine.QueryResult | null;
        position: GridElement;
    }[];
}

/// A viz grid
export class VizGrid extends React.Component<IVizGridProps, IVizGridState> {
    constructor(props: IVizGridProps) {
        super(props);
        this.state = VizGrid.computeLayout(props);
    }

    protected static computeLayout(props: IVizGridProps): IVizGridState {
        return {
            visualizations: props.module
                .getStatementsList()
                .map(statement => statement.getViz())
                .filter(isPresent)
                .map((visualization, i) => ({
                    statement: visualization,
                    data:
                        props.queryResults.get(
                            visualization.getQueryName()!.getString(),
                        ) || null,
                    position: new GridElement(i % 2 == 0 ? [0, 6] : [6, 12], [
                        0 + ((i / 2) | 0) * 6,
                        6 + ((i / 2) | 0) * 6,
                    ]),
                })),
        };
    }

    public componentDidUpdate(prevProps: IVizGridProps) {
        if (
            this.props.module === prevProps.module &&
            this.props.queryResults.equals(prevProps.queryResults)
        ) {
            return;
        }

        this.setState(VizGrid.computeLayout(this.props));
    }

    public render() {
        return (
            <div className={styles.container}>
                {this.state.visualizations.map(visualization => (
                    <VizCard
                        key={visualization.statement.getName()?.getString()}
                        statement={visualization.statement}
                        data={visualization.data}
                        position={visualization.position}
                    />
                ))}
            </div>
        );
    }
}

/// Connect the viz grid to redux
function mapStateToProps(state: Store.RootState) {
    return {
        module: state.tqlModule,
        queryResults: state.tqlQueryResults,
    };
}
export default connect(mapStateToProps, _dispatch => {
    return {};
})(VizGrid);
