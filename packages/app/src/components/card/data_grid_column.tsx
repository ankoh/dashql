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
    getColumnName(): string;
    getLayoutInfo(): ColumnLayoutInfo;
    renderCell(row: number, key: string, style: React.CSSProperties): React.ReactElement;
}

export class TextColumnRenderer implements ColumnRenderer {
    readonly columnName: string;
    readonly valueClassName: string;
    readonly values: string[];
    readonly valueMaxLength: number;
    readonly valueAvgLength: number;
    readonly valueDomainQuotient: number[];

    protected constructor(
        columnName: string,
        valueClassName: string,
        values: string[],
        valueMaxLength: number,
        valueAvgLength: number,
        valueDomainQuotient: number[],
    ) {
        this.columnName = columnName;
        this.valueClassName = valueClassName;
        this.values = values;
        this.valueMaxLength = valueMaxLength;
        this.valueAvgLength = valueAvgLength;
        this.valueDomainQuotient = valueDomainQuotient;
    }

    public static ReadFrom(table: core.model.TableSummary, data: arrow.Table, index: number): TextColumnRenderer {
        const column = data.getColumnAt(index)!;
        let valueClassName = styles.data_value_text;
        let formatter = (v: any): string => v.toString();
        let quotient = null;

        // Find formatter and classname
        switch (column.type.typeId) {
            case arrow.Type.Int:
            case arrow.Type.Int16:
            case arrow.Type.Int32:
            case arrow.Type.Int64:
            case arrow.Type.Float:
            case arrow.Type.Float16:
            case arrow.Type.Float32:
            case arrow.Type.Float64: {
                valueClassName = styles.data_value_number;
                formatter = (v: any) => v.toString();

                const minKey = core.model.buildTableStatisticsKey(core.model.TableStatisticsType.MINIMUM_VALUE, index);
                const maxKey = core.model.buildTableStatisticsKey(core.model.TableStatisticsType.MAXIMUM_VALUE, index);
                if (table.statistics.has(minKey) && table.statistics.has(maxKey)) {
                    const min = (table.statistics.get(minKey)!.get(0) || 0) * 0.75;
                    const max = table.statistics.get(maxKey)!.get(0) || 1;
                    quotient = (v: any) => {
                        return (v - min) / (max - min);
                    };
                }
                break;
            }
            case arrow.Type.Utf8:
                valueClassName = styles.data_value_text;
                formatter = (v: any) => v;
                break;
            case arrow.Type.TimeMicrosecond:
                console.warn('not implemented: arrow formatting TimeMicrosecond');
                break;
            case arrow.Type.TimeMillisecond:
                console.warn('not implemented: arrow formatting TimeMillisecond');
                break;
            case arrow.Type.Timestamp: {
                valueClassName = styles.data_value_text;
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
            case arrow.Type.DateMillisecond:
            case arrow.Type.DateDay:
            case arrow.Type.Date:
                valueClassName = styles.data_value_text;
                formatter = (v: any) =>
                    v.toLocaleDateString('en-US', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                    });
                break;

            default:
                break;
        }

        const values = [];
        const valueDomainQuotient = [];
        let valueLengthSum = 0;
        let valueLengthMax = 0;
        for (const chunk of column.chunks) {
            for (const value of chunk) {
                const text = formatter(value);
                values.push(text);
                valueLengthSum += text.length;
                valueLengthMax = Math.max(valueLengthMax, text.length);
                if (quotient) {
                    valueDomainQuotient.push(quotient(value));
                }
            }
        }
        console.log(valueDomainQuotient);
        return new TextColumnRenderer(
            column.name,
            valueClassName,
            values,
            valueLengthMax,
            valueLengthSum / values.length,
            valueDomainQuotient,
        );
    }

    public getColumnName(): string {
        return this.columnName;
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
            <div key={key} className={styles.cell_data} style={style}>
                {row < this.valueDomainQuotient.length && (
                    <div
                        className={styles.data_quotient}
                        style={{
                            width: this.valueDomainQuotient[row] * 100 + '%',
                        }}
                    />
                )}
                <div className={classNames(styles.data_value, this.valueClassName)}>{this.values[row]}</div>
            </div>
        );
    }
}

export function deriveColumnRenderers(table: core.model.TableSummary, data: core.access.ScanResult): ColumnRenderer[] {
    const columns = [];
    const fields = data.result.schema.fields;
    for (let i = 0; i < fields.length; ++i) {
        const renderer = TextColumnRenderer.ReadFrom(table, data.result, i);
        columns.push(renderer);
    }
    return columns;
}
