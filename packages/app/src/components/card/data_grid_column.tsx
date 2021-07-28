import * as core from '@dashql/core';
import * as arrow from 'apache-arrow';
import classNames from 'classnames';
import React from 'react';

import styles from './data_grid_column.module.css';

export interface ColumnLayoutInfo {
    headerWidth: number;
    valueAvgWidth: number;
    valueMaxWidth: number;
}

export interface ColumnRenderer {
    getLayoutInfo(): ColumnLayoutInfo;
    renderCell(row: number, key: string, style: React.CSSProperties): React.ReactElement;
}

export class TextColumnRenderer implements ColumnRenderer {
    readonly columnName: string;
    readonly className: string;
    readonly values: string[];
    readonly valueMaxLength: number;
    readonly valueAvgLength: number;

    protected constructor(
        columnName: string,
        className: string,
        values: string[],
        valueMaxLength: number,
        valueAvgLength: number,
    ) {
        this.columnName = columnName;
        this.className = className;
        this.values = values;
        this.valueMaxLength = valueMaxLength;
        this.valueAvgLength = valueAvgLength;
    }

    public static ReadFrom(column: arrow.Column): TextColumnRenderer {
        let className = styles.cell_data;
        let formatter = (v: any): string => v.toString();

        // Find formatter and classname
        switch (column.type.typeId) {
            case arrow.Type.Int:
            case arrow.Type.Int16:
            case arrow.Type.Int32:
            case arrow.Type.Int64:
            case arrow.Type.Float:
            case arrow.Type.Float16:
            case arrow.Type.Float32:
            case arrow.Type.Float64:
                className = classNames(styles.cell_data, styles.cell_data_number);
                formatter = (v: any) => v.toString();
                break;
            case arrow.Type.Utf8:
                className = classNames(styles.cell_data, styles.cell_data_text);
                formatter = (v: any) => v;
                break;
            case arrow.Type.TimeMicrosecond:
                console.warn('not implemented: arrow formatting TimeMicrosecond');
                break;
            case arrow.Type.TimeMillisecond:
                console.warn('not implemented: arrow formatting TimeMillisecond');
                break;
            case arrow.Type.Timestamp: {
                className = classNames(styles.cell_data, styles.cell_data_text);
                const type = column.type as arrow.Timestamp;
                switch (type.unit) {
                    case arrow.TimeUnit.SECOND:
                        formatter = (v: any) => new Date(v).toString();
                        break;
                    case arrow.TimeUnit.MICROSECOND:
                    case arrow.TimeUnit.MILLISECOND:
                    case arrow.TimeUnit.NANOSECOND:
                        console.warn('not implemented: arrow formatting Timestamp');
                        break;
                }
                break;
            }
            case arrow.Type.TimestampMicrosecond:
                console.warn('not implemented: arrow formatting TimestampMicrosecond');
                break;
            case arrow.Type.TimestampMillisecond:
                console.warn('not implemented: arrow formatting TimestampMillisecond');
                break;
            case arrow.Type.TimestampNanosecond:
                console.warn('not implemented: arrow formatting TimestampNanosecond');
                break;
            case arrow.Type.TimeSecond:
                console.warn('not implemented: arrow formatting TimeSecond');
                break;
            case arrow.Type.Date:
                className = classNames(styles.cell_data, styles.cell_data_text);
                formatter = (v: any) => v.toString();
                break;
            case arrow.Type.DateDay:
                console.warn('not implemented: arrow formatting DateDay');
                break;
            case arrow.Type.DateMillisecond:
                console.warn('not implemented: arrow formatting DateMillisecond');
                break;

            default:
                break;
        }

        const values = [];
        let valueLengthSum = 0;
        let valueLengthMax = 0;
        for (const chunk of column.chunks) {
            for (let i = 0; i < chunk.numChildren; ++i) {
                const text = formatter(chunk.get(i));
                values.push(text);
                valueLengthSum += text.length;
                valueLengthMax = Math.max(valueLengthMax, text.length);
            }
        }
        return new TextColumnRenderer(column.name, className, values, valueLengthMax, valueLengthSum / values.length);
    }

    public getLayoutInfo(): ColumnLayoutInfo {
        return {
            headerWidth: this.columnName.length,
            valueMaxWidth: this.valueMaxLength,
            valueAvgWidth: this.valueAvgLength,
        };
    }

    public renderCell(row: number, key: string, style: React.CSSProperties): React.ReactElement {
        return (
            <div key={key} className={this.className} style={style}>
                {this.values[row]}
            </div>
        );
    }
}

export function deriveColumnRenderers(data: core.access.ScanResult): ColumnRenderer[] {
    return [];
}
