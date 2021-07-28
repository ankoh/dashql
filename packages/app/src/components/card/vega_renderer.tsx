import * as React from 'react';
import * as arrow from 'apache-arrow';
import { IterableArrayLike, RowLike } from 'apache-arrow/type';
import * as core from '@dashql/core';
import * as model from '../../model';
import { connect } from 'react-redux';
import { AutoSizer } from '../../util/autosizer';
import { IAppContext, withAppContext } from '../../app_context';
import { Vega } from 'react-vega';
import { CardFrame } from './card_frame';

interface VegaWithRowsProps {
    data: arrow.Table;
    width: number;
    height: number;
    vegaSpec: any;
}

interface VegaWithRowsState {
    data: arrow.Table;
    rows: IterableArrayLike<RowLike<any>>;
}

class VegaWithRows extends React.Component<VegaWithRowsProps, VegaWithRowsState> {
    constructor(props: VegaWithRowsProps) {
        super(props);
        this.state = VegaWithRows.getDerivedStateFromProps(props);
    }

    shouldComponentUpdate(nextProps: VegaWithRowsProps) {
        return (
            nextProps.data != this.props.data ||
            nextProps.width !== this.props.width ||
            nextProps.height !== this.props.height ||
            nextProps.vegaSpec !== this.props.vegaSpec
        );
    }

    static getDerivedStateFromProps(props: VegaWithRowsProps, prevState?: VegaWithRowsState): VegaWithRowsState {
        if (!prevState || props.data !== prevState?.data) {
            return {
                data: props.data,
                rows: props.data.toArray(),
            };
        } else {
            return prevState;
        }
    }

    public render() {
        return (
            <Vega
                style={{
                    width: this.props.width,
                    height: this.props.height,
                }}
                spec={this.props.vegaSpec as any}
                data={{ source: this.state.rows }}
                width={this.props.width}
                height={this.props.height}
                actions={false}
            />
        );
    }
}

interface Props {
    appContext: IAppContext;
    planState: core.model.PlanState;
    card: core.model.CardSpecification;
    editable?: boolean;
}

export class VegaRenderer extends React.Component<Props> {
    protected renderContent(table: core.model.TableSummary, width: number, height: number): React.ReactElement {
        if (width == 0 && height == 0) return <div />;
        console.assert(!!this.props.card.dataSource);

        switch (this.props.card.dataSource!.dataResolver) {
            case core.model.CardDataResolver.M5: {
                return (
                    <core.access.M5Provider
                        logger={this.props.appContext.platform!.logger}
                        database={this.props.appContext.platform!.database}
                        table={table}
                        data={this.props.card.dataSource!}
                        width={width}
                    >
                        {result => (
                            <VegaWithRows
                                data={result}
                                width={width}
                                height={height}
                                vegaSpec={this.props.card.vegaSpec}
                            />
                        )}
                    </core.access.M5Provider>
                );
            }

            case core.model.CardDataResolver.RESERVOIR_SAMPLE: {
                return (
                    <core.access.SampleProvider
                        logger={this.props.appContext.platform!.logger}
                        database={this.props.appContext.platform!.database}
                        table={table}
                        data={this.props.card.dataSource!}
                    >
                        {result => (
                            <VegaWithRows
                                data={result}
                                width={width}
                                height={height}
                                vegaSpec={this.props.card.vegaSpec}
                            />
                        )}
                    </core.access.SampleProvider>
                );
            }

            default:
                return <div />;
        }
    }

    public render(): React.ReactElement {
        const target = this.props.card.dataSource!.targetQualified;
        const table = core.model.resolveTableByName(this.props.planState, target);
        if (!table) {
            return <div />;
        }
        return (
            <CardFrame title={this.props.card.title || target} controls={this.props.editable}>
                <AutoSizer>{({ width, height }) => this.renderContent(table, width, height)}</AutoSizer>
            </CardFrame>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    planState: state.core.planState,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(VegaRenderer));
