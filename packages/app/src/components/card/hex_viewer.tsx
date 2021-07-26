import * as React from 'react';
import className from 'classnames';
import { List, ListRowProps } from 'react-virtualized';

import styles from './hex_viewer.module.css';

const OVERSCAN_ROW_COUNT = 5;
const PIXEL_PER_CHAR = 7.7;

interface Props {
    width: number;
    height: number;
    buffer: ArrayBuffer;
}

interface State {
    u8Buffer: Uint8Array;
    rowOffsetChars: number;
    rowOffsetZeroPadding: string;
    rowColumnTemplate: string;
    rowBytes: number;
    rowCount: number;
}

export class HexViewer extends React.Component<Props, State> {
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyBuffer = this.renderEmptyBuffer.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = HexViewer.getDerivedStateFromProps(props);
    }

    static getDerivedStateFromProps(props: Props, _prevState?: State): State {
        const u8Buffer = new Uint8Array(props.buffer);

        // Compute width of offset column
        const rowOffsetChars = Math.max(2 * Math.ceil(u8Buffer.byteLength.toString(16).length / 2), 4);
        const rowOffsetWidth = 16 + rowOffsetChars * PIXEL_PER_CHAR;
        const rowOffsetZeroPadding = '0'.repeat(rowOffsetChars);

        // Compute number of hex blocks
        const computeHexWidth = (bytes: number) =>
            (Math.max(bytes / 4, 1) - 1) * PIXEL_PER_CHAR + 8 + bytes * 3 * PIXEL_PER_CHAR;
        const computeAsciiWidth = (bytes: number) => 16 + bytes * PIXEL_PER_CHAR;
        const computeTotalWidth = (blocks: number) => [computeHexWidth(blocks), computeAsciiWidth(blocks)];

        // Compute the total widths
        let bytes = 1;
        let hexWidth = computeHexWidth(1);
        let asciiWidth = computeAsciiWidth(1);
        for (;;) {
            const [h, a] = computeTotalWidth(bytes + 1);
            if (rowOffsetWidth + h + a > props.width - 8) break;
            bytes = bytes + 1;
            hexWidth = h;
            asciiWidth = a;
        }

        // Set state
        const rowCount = Math.ceil(u8Buffer.byteLength / bytes);
        const rowColumnTemplate = `${rowOffsetWidth}px ${hexWidth}px ${asciiWidth}px`;
        return {
            u8Buffer,
            rowOffsetChars,
            rowOffsetZeroPadding,
            rowColumnTemplate,
            rowBytes: bytes,
            rowCount,
        };
    }

    protected renderRow(props: ListRowProps): React.ReactElement {
        const begin = props.index * this.state.rowBytes;
        const beginBase16Padded = (this.state.rowOffsetZeroPadding + begin.toString(16)).slice(
            -this.state.rowOffsetChars,
        );
        const end = begin + Math.min(this.state.rowBytes, this.state.u8Buffer.byteLength - begin);

        const chars = [];
        let ascii = '';
        let byte = begin;
        for (let i = 0; i < Math.min(end - begin, this.state.rowBytes); ++i, ++byte) {
            const rawU8 = this.state.u8Buffer[byte];
            const text = ('0' + rawU8.toString(16)).slice(-2);
            chars.push(
                <div
                    key={i}
                    className={className(styles.hex_row_byte, {
                        [styles.hex_row_byte_block]: i > 0 && i % 4 == 0,
                    })}
                >
                    {text}
                </div>,
            );
            ascii += rawU8 > 31 && rawU8 < 127 ? String.fromCharCode(rawU8) : '.';
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
                <div className={styles.hex_row_bytes}>{chars}</div>
                <div className={styles.hex_row_ascii}>{ascii}</div>
            </div>
        );
    }

    public renderEmptyBuffer(): React.ReactElement {
        return <div>Empty</div>;
    }

    /// Render the table
    public render(): React.ReactElement {
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
