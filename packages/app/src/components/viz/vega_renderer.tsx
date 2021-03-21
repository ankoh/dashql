import * as Immutable from 'immutable';
import * as React from 'react';
import * as proto from '@dashql/proto';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import { VizCard } from './viz_card';
import { Vega } from 'react-vega';

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
    editable?: boolean;
}

export class VegaRenderer extends React.Component<Props> {
    protected renderContent(table: core.model.DatabaseTableInfo, width: number, height: number) {
        let vega = (result: proto.webdb.QueryResult, width: number, height: number) => (
            <core.access.ProxyProvider result={result}>
                {rows => (
                    <Vega
                        style={{
                            width: width,
                            height: height,
                        }}
                        spec={this.props.vizInfo.vegaSpec as any}
                        data={{ source: rows }}
                        width={width}
                        height={height}
                        actions={false}
                    />
                )}
            </core.access.ProxyProvider>
        );

        switch (this.props.vizInfo.dataSource.queryType) {
            case core.model.VizQueryType.M5: {
                return (
                    <core.access.M5Provider
                        logger={this.props.appContext.platform!.logger}
                        database={this.props.appContext.platform!.database}
                        table={table}
                        data={this.props.vizInfo.dataSource}
                        width={width}
                    >
                        {result => vega(result, width, height)}
                    </core.access.M5Provider>
                );
            }

            case core.model.VizQueryType.RESERVOIR_SAMPLE: {
                return (
                    <core.access.SampleProvider
                        logger={this.props.appContext.platform!.logger}
                        database={this.props.appContext.platform!.database}
                        table={table}
                        data={this.props.vizInfo.dataSource}
                    >
                        {result => vega(result, width, height)}
                    </core.access.SampleProvider>
                );
            }

            default:
                return <div />;
        }
    }

    public render() {
        const targetQualified = this.props.vizInfo.dataSource.targetQualified;
        const table = this.props.dbObjects.get(targetQualified);
        if (!table) {
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title || 'Some Title'} controls={this.props.editable}>
                <AutoSizer>{({ width, height }) => this.renderContent(table, width, height)}</AutoSizer>
            </VizCard>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    dbObjects: state.core.planDatabaseTables,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VegaRenderer));
