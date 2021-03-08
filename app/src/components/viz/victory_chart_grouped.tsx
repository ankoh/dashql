import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import { IAppContext } from '../../app_context';
import * as vy from 'victory';

interface Props {
    appContext: IAppContext;
    tableInfo: core.model.DatabaseTableInfo;
    vizInfo: core.model.VizInfo;
    width: number;
    height: number;
}

export class VictoryChartGrouped extends React.Component<Props> {
    public renderComponent(i: number, c: core.model.VizComponentSpec, partitions: webdb.RowProxy[][]) {
    }

    public render() {
        let groupByColumns: number[] = [];

        // XXX collect aggregate columns

        // XXX collect group columns

        // Build group column list
        let groupColumnList = "";
        for (let i = 0; i < groupByColumns.length; ++i) {
            if (i > 0) groupColumnList += ", ";
            groupColumnList += this.props.tableInfo.columnNames[i];
        }
  
        // Build query
        let query = `
            SELECT ${groupColumnList}
            FROM ${this.props.tableInfo.nameShort}
            GROUP BY ${groupColumnList}
            ORDER BY ${groupColumnList}
        `;
        return (
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
                                        width: this.props.width,
                                        height: this.props.height,
                                    },
                                }}
                                width={this.props.width}
                                height={this.props.height}
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
        );
    }
}

export default VictoryChartGrouped;
