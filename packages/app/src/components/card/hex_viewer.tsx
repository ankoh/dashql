import * as React from 'react';
import * as core from '@dashql/core';
import { List, ListRowProps } from 'react-virtualized';

import styles from './hex_viewer.module.css';

const OVERSCAN_ROW_COUNT = 5;
const PIXEL_PER_CHAR = 8;

interface Props {
    planState: core.model.PlanState;
    card: core.model.CardSpecification;
    editable?: boolean;
    width: number;
    height: number;
}

interface State {
    bufferLoading: boolean;
    buffer: Uint8Array | null;
    error: string | null;
    rowOffsetChars: number;
    rowOffsetZeroPadding: string;
    rowColumnTemplate: string;
    rowBytes: number;
    rowBytesPerBlock: number;
    rowCount: number;
}

export class HexViewer extends React.Component<Props, State> {
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
            rowBytesPerBlock: 0,
            rowCount: 0,
        };
    }

    public displayBuffer(buffer: ArrayBuffer): void {
        const u8Buffer = new Uint8Array(buffer);

        // Compute width of offset column
        const rowOffsetChars = Math.max(2 * Math.ceil(u8Buffer.byteLength.toString(16).length / 2), 4);
        const rowOffsetWidth = 16 + rowOffsetChars * PIXEL_PER_CHAR;
        const rowOffsetZeroPadding = '0'.repeat(rowOffsetChars);

        // Compute number of hex blocks
        const computeHexWidth = (blocks: number, bytes_per_block: number) => {
            const padding = 8 + (blocks - 1) * PIXEL_PER_CHAR * 0.5;
            return padding + blocks * bytes_per_block * 3 * PIXEL_PER_CHAR;
        };
        const computeAsciiWidth = (blocks: number, bytes_per_block: number) =>
            16 + blocks * bytes_per_block * PIXEL_PER_CHAR;
        const computeTotalWidth = (blocks: number, bytes_per_block: number) => {
            const h = computeHexWidth(blocks, bytes_per_block);
            const a = computeAsciiWidth(blocks, bytes_per_block);
            return [h, a];
        };

        // Compute the total widths
        let selectedBytesPerBlock = 4;
        let [selectedBlocks, selectedHexWidth, selectedAsciiWidth] = computeTotalWidth(1, 4);
        let totalWidth = rowOffsetWidth + selectedHexWidth + selectedAsciiWidth;
        for (const perBlock of [4, 8]) {
            for (let i = 1; ; ++i) {
                const [h, a] = computeTotalWidth(i, perBlock);
                const w = rowOffsetWidth + h + a;
                if (w < totalWidth || w > this.props.width) break;
                selectedBytesPerBlock = perBlock;
                selectedBlocks = i;
                selectedHexWidth = h;
                selectedAsciiWidth = a;
                totalWidth = w;
            }
        }

        // Set state
        const rowBytes = selectedBlocks * selectedBytesPerBlock;
        const rowCount = Math.ceil(u8Buffer.byteLength / rowBytes);
        const rowColumnTemplate = `${rowOffsetWidth}px ${selectedHexWidth}px ${selectedAsciiWidth}px`;
        this.setState({
            buffer: u8Buffer,
            rowOffsetChars,
            rowOffsetZeroPadding,
            rowColumnTemplate,
            rowBytes,
            rowBytesPerBlock: selectedBytesPerBlock,
            rowCount,
        });
    }

    public componentDidUpdate(): void {
        const target = this.props.card.dataSource!.targetQualified;
        if (this.state.buffer || this.state.bufferLoading) return;

        const obj = core.model.resolveBlobByName(this.props.planState, target)!;
        obj.blob.arrayBuffer().then(b => this.displayBuffer(b));
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
        let ascii = '';
        for (let byte = begin, row = 0; byte < end; ++row) {
            const block = [];
            const blockBegin = byte;
            for (let j = 0; j < Math.min(end - blockBegin, this.state.rowBytesPerBlock); ++j, ++byte) {
                const rawU8 = this.state.buffer![byte];
                const text = ('0' + rawU8.toString(16)).slice(-2);
                block.push(
                    <div key={j} className={styles.hex_row_byte}>
                        {text}
                    </div>,
                );
                ascii += rawU8 > 31 && rawU8 < 127 ? String.fromCharCode(rawU8) : '.';
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
                <div className={styles.hex_row_ascii}>{ascii}</div>
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
            <div style={{ width: this.props.width, height: this.props.height }}>
                <List
                    className={styles.list}
                    width={this.props.width}
                    height={this.props.height}
                    overscanRowCount={OVERSCAN_ROW_COUNT}
                    rowCount={this.state.rowCount}
                    rowHeight={24}
                    rowRenderer={this._renderRow}
                    noRowsRenderer={this._renderEmptyBuffer}
                    measureAllRows={true}
                />
            </div>
        );
    }
}

export default HexViewer;
