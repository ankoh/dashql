import * as Immutable from 'immutable';
import * as React from 'react';
import * as Store from '../../store';
import * as proto from '@tigon/proto';
import Table from '../viz/table';
import ChartViewer from '../viz/chart_viewer';
import { connect } from 'react-redux';
import { withAutoSizer } from '../autosizer';

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

    /// CSS values
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

/// A length unit in the grid
export enum GridLengthUnit {
    FRACTIONAL,
    PIXEL,
    EM,
    AUTO,
    MIN_CONTENT,
    MAX_CONTENT,
    MIN_MAX,
}

/// A grid layout
export class GridLayout {
    /// The column count
    columnCount: number;
    /// The row height
    rowHeight: number;

    /// Constructor
    constructor() {
        this.columnCount = 12;
        this.rowHeight = 48;
    }
}

/// A viz card
function VizCard(props: {
    statement: proto.tql.VizStatement;
    data: proto.engine.QueryResult | null;
    pos: GridElement;
}) {
    let viz: React.ReactElement | null = null;
    if (props.data) {
        switch (props.statement.getVizType()?.getType()) {
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
                viz = <ChartViewer />;
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
            className={styles.viz}
            style={{
                gridArea: props.pos.cssArea,
            }}
        >
            <div className={styles.viz_id}>{name}</div>
            <div className={styles.viz_card}>
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
        </div>
    );
}

/// Viz grid properties
interface IVizGridProps {
    module: proto.tql.Module;
    queryResults: Immutable.Map<string, proto.engine.QueryResult>;

    sizeClass: Store.SizeClass;
    width: number;
    height: number;
}

/// A viz grid state
interface IVizGridState {
    gridLayout: GridLayout;
    vizStatements: Array<proto.tql.VizStatement>;
    vizPositions: Array<GridElement>;
    vizData: Array<proto.engine.QueryResult | null>;
}

/// A viz grid
export class VizGrid extends React.Component<IVizGridProps, IVizGridState> {
    constructor(props: IVizGridProps) {
        super(props);
        this.state = VizGrid.computeLayout(props);
    }

    protected static computeLayout(props: IVizGridProps): IVizGridState {
        // Get the viz statements
        const vizStatements: proto.tql.VizStatement[] = [];

        for (const statement of props.module.getStatementsList()) {
            const viz = statement.getViz();

            if (viz) {
                vizStatements.push(viz);
            }
        }

        const vizData = vizStatements.map(
            statement =>
                props.queryResults.get(statement.getQueryName()!.getString()) ||
                null,
        );

        const gridLayout = new GridLayout();

        // TODO layouting

        return {
            gridLayout,
            vizStatements,
            vizPositions: [
                new GridElement([0, 6], [0, 20]),
                new GridElement([6, 12], [0, 20]),
            ],
            vizData,
        };
    }

    public componentDidUpdate(prevProps: IVizGridProps) {
        if (
            this.props.module === prevProps.module &&
            this.props.queryResults.equals(prevProps.queryResults) &&
            this.props.width === prevProps.width &&
            this.props.height === prevProps.height
        ) {
            return;
        }
        this.setState(VizGrid.computeLayout(this.props));
    }

    public render() {
        return (
            <div
                className={styles.container}
                style={{
                    width: this.props.width,
                    height: this.props.height,
                }}
            >
                {this.state.vizStatements.map((statement, i) => (
                    <VizCard
                        key={statement.getName()?.getString()}
                        statement={statement}
                        pos={this.state.vizPositions[i]}
                        data={this.state.vizData[i]}
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
})(withAutoSizer(VizGrid));
