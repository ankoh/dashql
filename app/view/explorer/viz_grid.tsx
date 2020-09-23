import * as Immutable from 'immutable';
import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@dashql/proto';
import { isPresent } from '../../util/functional';
import * as Store from '../../store';
import Table from '../viz/table';
import ChartViewer from '../viz/chart_viewer';

import styles from './viz_grid.module.scss';
import { DeleteIcon, EditIcon, RefreshIcon } from '../../svg/icons';

const ACTION_ICON_WIDTH = '16px';
const ACTION_ICON_HEIGHT = '16px';

/// A grid element
export class GridElement {
    /// The column start
    columns: [number, number];
    /// The row start
    rows: [number, number];

    /// Constructor
    constructor(columns: [number, number], rows: [number, number]) {
        this.columns = columns;
        this.rows = rows;
    }

    get cssColumnsBegin() {
        return this.columns[0] + 1;
    }

    get cssColumnsEnd() {
        return this.columns[1] + 1;
    }

    get cssRowsBegin() {
        return this.rows[0] + 1;
    }

    get cssRowsEnd() {
        return this.rows[1] + 1;
    }

    get cssArea(): string {
        return (
            this.cssRowsBegin +
            ' / ' +
            this.cssColumnsBegin +
            ' / ' +
            this.cssRowsEnd +
            ' / ' +
            this.cssColumnsEnd
        );
    }
}

/// A viz card
function VizCard(props: {
    statement: proto.tql.VizStatement;
    data: proto.engine.QueryResult | null;
    position: GridElement;
}) {
    let viz: React.ReactElement | null = null;

    if (props.data) {
        const type = props.statement.getVizType()?.getType();

        switch (type) {
            case proto.tql.VizTypeType.VIZ_AREA:
            case proto.tql.VizTypeType.VIZ_BAR:
            case proto.tql.VizTypeType.VIZ_BOX:
            case proto.tql.VizTypeType.VIZ_BUBBLE:
            case proto.tql.VizTypeType.VIZ_GRID:
            case proto.tql.VizTypeType.VIZ_HISTOGRAM:
            case proto.tql.VizTypeType.VIZ_LINE:
            case proto.tql.VizTypeType.VIZ_NUMBER:
            case proto.tql.VizTypeType.VIZ_PIE:
            case proto.tql.VizTypeType.VIZ_SCATTER:
            case proto.tql.VizTypeType.VIZ_POINT:
                viz = <ChartViewer data={props.data} type={type} />;
                break;
            case proto.tql.VizTypeType.VIZ_TABLE:
                viz = <Table data={props.data} />;
                break;
            case proto.tql.VizTypeType.VIZ_TEXT:
                break;
        }
    }

    const name = props.statement.getName()?.getString();

    return (
        <div
            className={styles.viz_card}
            style={{
                gridArea: props.position.cssArea,
            }}
        >
            <div className={styles.viz_card_header}>
                <div className={styles.viz_card_title}>{name}</div>
                <div className={styles.viz_card_action_refresh}>
                    <RefreshIcon
                        className={styles.viz_card_action_icon}
                        width={ACTION_ICON_WIDTH}
                        height={ACTION_ICON_HEIGHT}
                    />
                </div>
                <div className={styles.viz_card_action_edit}>
                    <EditIcon
                        className={styles.viz_card_action_icon}
                        width={ACTION_ICON_WIDTH}
                        height={ACTION_ICON_HEIGHT}
                    />
                </div>
                <div className={styles.viz_card_action_delete}>
                    <DeleteIcon
                        className={styles.viz_card_action_icon}
                        width={ACTION_ICON_WIDTH}
                        height={ACTION_ICON_HEIGHT}
                    />
                </div>
            </div>
            <div className={styles.viz_card_body}>{viz}</div>
        </div>
    );
}

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
