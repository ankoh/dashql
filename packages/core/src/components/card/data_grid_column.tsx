import * as arrow from 'apache-arrow';
import * as model from '../../model';
import * as access from '../../access';
import classNames from 'classnames';
import React from 'react';
import { MiniBarChart } from '../minibar_chart';

import styles from './data_grid_column.module.css';

// Automatically enable domain ratios for numerical data if
// (min(x) / max(x)) <= NUMERIC_DOMAIN_RATIO_THRESHOLD
const NUMERIC_DOMAIN_RATIO_THRESHOLD = 0.75;

export interface ColumnLayoutInfo {
    headerWidth: number;
    valueAvgWidth: number;
    valueMaxWidth: number;
    auxiliaries: number;
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
    readonly valueDomainRatios: number[];

    protected constructor(
        columnName: string,
        valueClassName: string,
        values: string[],
        valueMaxLength: number,
        valueAvgLength: number,
        valueDomainRatios: number[],
    ) {
        this.columnName = columnName;
        this.valueClassName = valueClassName;
        this.values = values;
        this.valueMaxLength = valueMaxLength;
        this.valueAvgLength = valueAvgLength;
        this.valueDomainRatios = valueDomainRatios;
    }

    public static ReadFrom(table: model.TableMetadata, data: arrow.Table, index: number): TextColumnRenderer {
        const columnName = data.schema.fields[index].name!;
        const column = data.getChildAt(index)!;
        let valueClassName = styles.data_value_text;
        let formatter = (v: any): string => v.toString();
        let valueDomainRatio = null;

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
                formatter = (v: any) => v.toLocaleString('en-US');

                const minKey = model.buildTableStatisticsKey(model.TableStatisticsType.MINIMUM_VALUE, index);
                const maxKey = model.buildTableStatisticsKey(model.TableStatisticsType.MAXIMUM_VALUE, index);
                if (table.statistics.has(minKey) && table.statistics.has(maxKey)) {
                    const min = table.statistics.get(minKey)!.get(0) || 0;
                    const max = table.statistics.get(maxKey)!.get(0) || 1;
                    if (min / max < NUMERIC_DOMAIN_RATIO_THRESHOLD) {
                        valueDomainRatio = (v: any) => {
                            return v / max;
                        };
                    }
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
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                    });
                break;

            default:
                break;
        }

        const values = [];
        const valueDomainRatios = [];
        let valueLengthSum = 0;
        let valueLengthMax = 0;
        for (const value of column) {
            const text = formatter(value);
            values.push(text);
            valueLengthSum += text.length;
            valueLengthMax = Math.max(valueLengthMax, text.length);
            if (valueDomainRatio) {
                valueDomainRatios.push(valueDomainRatio(value));
            }
        }
        return new TextColumnRenderer(
            columnName,
            valueClassName,
            values,
            valueLengthMax,
            valueLengthSum / values.length,
            valueDomainRatios,
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
            auxiliaries: this.valueDomainRatios.length > 0 ? 56 : 0,
        };
    }

    public renderCell(row: number, key: string, style: React.CSSProperties): React.ReactElement {
        if (row < this.valueDomainRatios.length) {
            return (
                <div key={key} className={styles.cell_with_domain} style={style}>
                    <div className={classNames(styles.data_value, this.valueClassName)}>{this.values[row]}</div>
                    <MiniBarChart className={styles.data_domain} value={this.valueDomainRatios[row]} />
                </div>
            );
        } else {
            return (
                <div key={key} className={styles.cell} style={style}>
                    <div className={classNames(styles.data_value, this.valueClassName)}>{this.values[row]}</div>
                </div>
            );
        }
    }
}

export function deriveColumnRenderers(table: model.TableMetadata, data: access.ScanResult): ColumnRenderer[] {
    const columns = [];
    const fields = data.result.schema.fields;
    for (let i = 0; i < fields.length; ++i) {
        const renderer = TextColumnRenderer.ReadFrom(table, data.result, i);
        columns.push(renderer);
    }
    return columns;
}
