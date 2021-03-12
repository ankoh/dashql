import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import { VizCard } from './viz_card';
import { Vega } from 'react-vega';
import * as vy from 'victory';

import TypeModifier = core.proto.syntax.VizComponentTypeModifier;
import ComponentType = core.proto.syntax.VizComponentType;

interface Props {
    appContext: IAppContext;
    dbObjects: Immutable.Map<string, core.model.DatabaseTableInfo>;
    vizInfo: core.model.VizInfo;
}

export class VictoryChartSimple extends React.Component<Props> {
    public render() {
        const targetQualified = this.props.vizInfo.nameQualified;
        const table = this.props.dbObjects.get(targetQualified);
        if (!table) {
            return <div />;
        }
        return (
            <VizCard title={this.props.vizInfo.title || 'Some Title'}>
                <AutoSizer>
                    {({ width, height }) => (
                        <core.access.VizQueryProvider
                            logger={this.props.appContext.platform!.logger}
                            database={this.props.appContext.platform!.database}
                            table={table}
                            data={this.props.vizInfo.data}
                            width={width}
                            height={height}
                        >
                            {result => (
                                <core.access.ProxyProvider result={result}>
                                    {rows => (
                                        <Vega
                                            style={{
                                                width: width,
                                                height: height,
                                            }}
                                            spec={{
                                                ...this.props.vizInfo.vegaSpec,
                                            }}
                                            data={{ source: rows }}
                                            width={width}
                                            height={height}
                                            actions={false}
                                        />
                                    )}
                                </core.access.ProxyProvider>
                            )}
                        </core.access.VizQueryProvider>
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

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VictoryChartSimple));
