import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { AutoSizer } from '../../util/autosizer';
import { VizCard } from './viz_card';
import { VictoryChart, VictoryAxis, VictoryLine, VictoryScatter, VictoryTheme } from 'victory';

import styles from './victory_renderer.module.css';

import ScanProvider = core.access.ScanProvider;

interface ChartComposerProps {
    logger: webdb.Logger;
    vizInfo: core.model.VizInfo;
    tableInfo: core.model.DatabaseTableInfo;
    data: core.access.ScanResult | null;
    requestData: (r: core.access.ScanRequest) => void;
}

interface ChartComposerState {
    rows: webdb.RowProxy[];
}

class ChartComposer extends React.Component<ChartComposerProps, ChartComposerState> {
    constructor(props: ChartComposerProps) {
        super(props);
        this.state = ChartComposer.getDerivedStateFromProps(props, { rows: [] });
    }

    static getDerivedStateFromProps(nextProps: ChartComposerProps, prevState: ChartComposerState): ChartComposerState {
        let rows: webdb.RowProxy[] = [];
        if (!nextProps.data) {
            return { rows };
        }
        const iter = new webdb.ChunkArrayIterator(nextProps.data.result);
        rows = iter.collectAllBlocking<webdb.RowProxy>();
        return { rows };
    }

    componentDidMount() {
        this.props.requestData(
            new core.access.ScanRequest()
                .withSample(1024));
    }

    render() {
        
        return (
            <AutoSizer>
                {({ height, width }) => (
                    <VictoryChart
                        style={{
                            parent: {
                                width: width,
                                height: height,
                            },
                        }}
                        width={width}
                        height={height}
                        padding={{
                            top: 20,
                            left: 40,
                            right: 30,
                            bottom: 40,
                        }}
                        theme={VictoryTheme.material}
                    >
                        <VictoryAxis />
                        <VictoryAxis dependentAxis />
                        <VictoryScatter
                            data={this.state.rows}
                            x="a"
                            y="b"
                        />
                    </VictoryChart>
                )}
            </AutoSizer>
        );
    }
}

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryRenderer extends React.Component<Props> {
    public render() {
        const logger = this.props.appContext.platform!.logger;
        const db = this.props.appContext.platform!.database;
        const targetShort = this.props.vizInfo.nameShort;
        const targetQualified = this.props.vizInfo.nameQualified;
        const tableInfo = this.props.dbObjects.get(targetQualified);
        if (!tableInfo) {
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title}>
                <ScanProvider logger={logger} database={db} targetName={targetShort}>
                    {(queryResults, requestQuery) => (
                        <ChartComposer
                            logger={logger}
                            vizInfo={this.props.vizInfo}
                            tableInfo={tableInfo}
                            data={queryResults}
                            requestData={requestQuery}
                        />
                    )}
                </ScanProvider>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryRenderer));
