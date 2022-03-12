import * as React from 'react';
import { clsx } from '../../utils';
import { List, ListRowProps } from 'react-virtualized';

import styles from './hex_viewer.module.css';

const OVERSCAN_ROW_COUNT = 5;
const PIXEL_PER_CHAR = 8;

interface Props {
    width: number;
    height: number;
    buffer: ArrayBuffer;
}

interface State {
    u8Buffer: Uint8Array;
    width: number;
    height: number;
    rowOffsetChars: number;
    rowOffsetZeroPadding: string;
    rowColumnTemplate: string;
    rowBytes: number;
    rowCount: number;
    mouseDown: boolean;
    focusedByteRange: [number, number] | null;
}

export class HexViewer extends React.Component<Props, State> {
    protected _renderRow = this.renderRow.bind(this);
    protected _renderEmptyBuffer = this.renderEmptyBuffer.bind(this);
    protected _onMouseEnter = this.onMouseEnter.bind(this);
    protected _onMouseLeave = this.onMouseLeave.bind(this);
    protected _onMouseUp = this.onMouseUp.bind(this);
    protected _onMouseDown = this.onMouseDown.bind(this);

    constructor(props: Props) {
        super(props);
        this.state = HexViewer.getDerivedStateFromProps(props, {
            u8Buffer: new Uint8Array(),
            width: 0,
            height: 0,
            rowOffsetChars: 0,
            rowOffsetZeroPadding: '',
            rowColumnTemplate: '',
            rowBytes: 0,
            rowCount: 0,
            mouseDown: false,
            focusedByteRange: null,
        });
    }

    isFocused(byteIndex: number): boolean {
        if (this.state.focusedByteRange == null) return false;
        const lb = Math.min(this.state.focusedByteRange[0], this.state.focusedByteRange[1]);
        const ub = Math.max(this.state.focusedByteRange[0], this.state.focusedByteRange[1]);
        return byteIndex >= lb && byteIndex <= ub;
    }

    static getDerivedStateFromProps(props: Props, prevState: State): State {
        let state: State = prevState;
        if (
            props.buffer != prevState?.u8Buffer.buffer ||
            props.width != prevState.width ||
            props.height != prevState.height
        ) {
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

            state = {
                width: props.width,
                height: props.height,
                u8Buffer,
                rowOffsetChars,
                rowOffsetZeroPadding,
                rowColumnTemplate,
                rowBytes: bytes,
                rowCount,
                mouseDown: false,
                focusedByteRange: null,
            };
        }
        return state;
    }

    protected onMouseDown(elem: React.MouseEvent<HTMLSpanElement>): void {
        const index = (elem.currentTarget as any).dataset.byteindex;
        this.setState({
            focusedByteRange: [index, index],
            mouseDown: true,
        });
    }

    protected onMouseUp(elem: React.MouseEvent<HTMLSpanElement>): void {
        const index = (elem.currentTarget as any).dataset.byteindex;
        this.setState({
            focusedByteRange: [index, index],
            mouseDown: false,
        });
    }

    protected onMouseEnter(elem: React.MouseEvent<HTMLSpanElement>): void {
        const index = (elem.currentTarget as any).dataset.byteindex;
        if (!this.state.mouseDown || this.state.focusedByteRange == null) {
            this.setState({
                focusedByteRange: [index, index],
            });
            return;
        }
        this.setState({
            focusedByteRange: [this.state.focusedByteRange[0], index],
        });
    }

    protected onMouseLeave(elem: React.MouseEvent<HTMLSpanElement>): void {
        const index = (elem.currentTarget as any).dataset.byteindex;
        if (this.state.mouseDown) return;
        if (this.isFocused(index)) {
            this.setState({
                focusedByteRange: null,
            });
        }
    }

    protected renderRow(props: ListRowProps): React.ReactElement {
        const begin = props.index * this.state.rowBytes;
        const beginBase16Padded = (this.state.rowOffsetZeroPadding + begin.toString(16)).slice(
            -this.state.rowOffsetChars,
        );
        const end = begin + Math.min(this.state.rowBytes, this.state.u8Buffer.byteLength - begin);

        const hex = [];
        const ascii = [];
        let byte = begin;
        for (let i = 0; i < Math.min(end - begin, this.state.rowBytes); ++i, ++byte) {
            const rawU8 = this.state.u8Buffer[byte];
            const text = ('0' + rawU8.toString(16)).slice(-2);
            hex.push(
                <span
                    key={i}
                    data-byteindex={byte}
                    className={clsx(styles.hex_row_byte, {
                        [styles.hex_row_byte_block]: i > 0 && i % 4 == 0,
                        [styles.hex_row_byte_focused]: this.isFocused(byte),
                    })}
                    onMouseEnter={this._onMouseEnter}
                    onMouseLeave={this._onMouseLeave}
                    onMouseDown={this._onMouseDown}
                    onMouseUp={this._onMouseUp}
                >
                    {text}
                </span>,
            );
            ascii.push(
                <span
                    key={i}
                    className={clsx(styles.hex_row_ascii_char, {
                        [styles.hex_row_ascii_char_focused]: this.isFocused(byte),
                    })}
                    data-byteindex={byte}
                    onMouseEnter={this._onMouseEnter}
                    onMouseLeave={this._onMouseLeave}
                    onMouseDown={this._onMouseDown}
                    onMouseUp={this._onMouseUp}
                >
                    {rawU8 == 10 || rawU8 == 13 || rawU8 == 32
                        ? '•'
                        : rawU8 > 31 && rawU8 < 127
                        ? String.fromCharCode(rawU8)
                        : '░'}
                </span>,
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
                <div className={styles.hex_row_bytes}>{hex}</div>
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
                    buffer={this.state.u8Buffer}
                    focusedByteRange={this.state.focusedByteRange}
                    className={styles.list}
                    width={this.props.width}
                    height={this.props.height}
                    overscanRowCount={OVERSCAN_ROW_COUNT}
                    rowCount={this.state.rowCount}
                    rowHeight={24}
                    rowRenderer={this._renderRow}
                    noRowsRenderer={this._renderEmptyBuffer}
                />
            </div>
        );
    }
}

export default HexViewer;
