import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { VizCard } from './viz_card';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import * as vy from 'victory';

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartGrouped extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, partitions: webdb.RowProxy[][]) {
    }

    public render() {
        const targetQualified = this.props.vizInfo.nameQualified;
        const tableInfo = this.props.dbObjects.get(targetQualified);
        if (!tableInfo) {
            return <div />;
        }

        let groupByColumns: number[] = [];

        // XXX collect aggregate columns

        // XXX collect group columns

        // Build group column list
        let groupColumnList = "";
        for (let i = 0; i < groupByColumns.length; ++i) {
            if (i > 0) groupColumnList += ", ";
            groupColumnList += tableInfo.columnNames[i];
        }
  
        // Build query
        let query = `
            SELECT ${groupColumnList}
            FROM ${tableInfo.nameShort}
            GROUP BY ${groupColumnList}
            ORDER BY ${groupColumnList}
        `;
        return (
            <VizCard title={this.props.vizInfo.title}>
                <AutoSizer>
                    {({ width, height }) => (
                        <core.access.QueryProvider
                            logger={this.props.appContext.platform!.logger}
                            database={this.props.appContext.platform!.database}
                            query={query}
                            queryOptions={{
                                partitionBoundaries: groupByColumns
                            }}
                        >
                            {(result) => (
                                <core.access.ProxyPartitionsProvider result={result}>
                                    {(_result, partitions) => (
                                        <vy.VictoryChart
                                            style={{
                                                parent: {
                                                    width: width,
                                                    height: height,
                                                },
                                            }}
                                            width={width}
                                            height={height}
                                            padding={{
                                                top: 16,
                                                left: 36,
                                                right: 20,
                                                bottom: 36,
                                            }}
                                            theme={vy.VictoryTheme.material}
                                        >
                                            {this.props.vizInfo.components.map((c, i) => this.renderComponent(i, c, partitions))}
                                        </vy.VictoryChart>
                                    )}
                                </core.access.ProxyPartitionsProvider>
                            )}
                        </core.access.QueryProvider>
                    )}
                </AutoSizer>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryChartGrouped));
