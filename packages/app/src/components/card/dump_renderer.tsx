import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../../model';
import { List, ListRowProps, AutoSizer } from 'react-virtualized';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../../app_context';
import { CardFrame } from './card_frame';

import styles from './dump_renderer.module.css';

const OVERSCAN_ROW_COUNT = 5;
const PIXEL_PER_CHAR = 8;
const BYTES_PER_BLOCK = 4;

interface Props {
    appContext: IAppContext;
    planState: core.model.PlanState;
    card: core.model.CardSpecification;
    editable?: boolean;
}

interface State {
    bufferLoading: boolean;
    buffer: Uint8Array | null;
    error: string | null;
    rowOffsetChars: number;
    rowOffsetZeroPadding: string;
    rowColumnTemplate: string;
    rowBytes: number;
    rowCount: number;
}

export class DumpRenderer extends React.Component<Props, State> {
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyBuffer = this.renderEmptyBuffer.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = {
            bufferLoading: false,
            buffer: null,
            error: null,
            rowOffsetChars: 0,
            rowOffsetZeroPadding: '',
            rowColumnTemplate: '',
            rowBytes: 0,
            rowCount: 0,
        };
    }

    public componentDidUpdate(): void {
        const target = this.props.card.dataSource!.targetQualified;
        if (this.state.buffer || this.state.bufferLoading) return;

        const obj = core.model.resolveBlobByName(this.props.planState, target)!;
        obj.blob.arrayBuffer().then(b => {
            const rowBytes = 12;
            const rowCount = Math.ceil(b.byteLength / rowBytes);
            const rowOffsetChars = Math.max(2 * Math.ceil(b.byteLength.toString(16).length / 2), 4);
            const rowOffsetZeroPadding = '0'.repeat(rowOffsetChars);
            const blockCount = Math.ceil(rowBytes / BYTES_PER_BLOCK);
            const totalBlockPadding = 8 + (blockCount - 1) * PIXEL_PER_CHAR * 0.5;
            const rowColumnTemplate = `${16 + rowOffsetChars * PIXEL_PER_CHAR}px ${
                totalBlockPadding + rowBytes * 3 * PIXEL_PER_CHAR
            }px`;
            this.setState({
                buffer: new Uint8Array(b),
                rowOffsetChars,
                rowOffsetZeroPadding,
                rowColumnTemplate,
                rowBytes,
                rowCount,
            });
        });
        this.setState({
            ...this.state,
            bufferLoading: true,
            buffer: null,
            rowOffsetChars: 0,
            rowBytes: 0,
            rowCount: 0,
        });
    }

    protected renderRow(props: ListRowProps): React.ReactElement {
        const begin = props.index * this.state.rowBytes;
        const beginBase16Padded = (this.state.rowOffsetZeroPadding + begin.toString(16)).slice(
            -this.state.rowOffsetChars,
        );
        const end = begin + Math.min(this.state.rowBytes, this.state.buffer!.byteLength - begin);

        const blocks = [];
        for (let byte = begin, row = 0; byte < end; ++row) {
            const block = [];
            const blockBegin = byte;
            for (let j = 0; j < Math.min(end - blockBegin, BYTES_PER_BLOCK); ++j, ++byte) {
                const text = ('0' + this.state.buffer![byte].toString(16)).slice(-2);
                block.push(
                    <div key={j} className={styles.hex_row_byte}>
                        {text}
                    </div>,
                );
            }
            blocks.push(
                <div key={row} className={styles.hex_row_byte_block}>
                    {block}
                </div>,
            );
        }
        return (
            <div
                key={props.key}
                className={styles.hex_row}
                style={{
                    ...props.style,
                    gridTemplateColumns: this.state.rowColumnTemplate,
                }}
            >
                <div className={styles.hex_row_offset}>{beginBase16Padded}</div>
                <div className={styles.hex_row_bytes}>{blocks}</div>
            </div>
        );
    }

    public renderEmptyBuffer(): React.ReactElement {
        return <div>Empty</div>;
    }

    /// Render the table
    public render(): React.ReactElement {
        if (!this.state.buffer) {
            return <div>Loading...</div>;
        }

        return (
            <CardFrame title={this.props.card.title || 'Some Title'} controls={this.props.editable}>
                <div className={styles.list_container}>
                    <AutoSizer>
                        {({ width, height }) => (
                            <>
                                <List
                                    className={styles.list}
                                    width={width}
                                    height={height}
                                    overscanRowCount={OVERSCAN_ROW_COUNT}
                                    rowCount={this.state.rowCount}
                                    rowHeight={24}
                                    rowRenderer={this._renderRow}
                                    noRowsRenderer={this._renderEmptyBuffer}
                                    measureAllRows={true}
                                />
                            </>
                        )}
                    </AutoSizer>
                </div>
            </CardFrame>
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    planState: state.core.planState,
});

const mapDispatchToProps = (_dispatch: model.Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(DumpRenderer));
