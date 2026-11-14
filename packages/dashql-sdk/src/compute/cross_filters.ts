import { ScalarFilter } from './sql/sqlframe_builder.js';
import { VariantKind } from "../utils/variant.js";
import { OrdinalGridColumnGroup, StringGridColumnGroup } from "./computation_types.js";

export const HISTOGRAM_FILTER = Symbol("HISTOGRAM_FILTER");
export const MOST_FREQUENT_FILTER = Symbol("MOST_FREQUENT_FILTER");

export type CrossFilterPredicate =
    | VariantKind<typeof HISTOGRAM_FILTER, HistogramFilterPredicate>
    | VariantKind<typeof MOST_FREQUENT_FILTER, MostFrequentFilterPredicate>
    ;

export interface HistogramFilterPredicate {
    /// The selection range
    selection: [number, number];
    /// The scalar filters
    filters: ScalarFilter[];
}

export interface MostFrequentFilterPredicate {
    /// The stable identifier of the selected value
    valueId: number;
    /// The scalar filters
    filters: ScalarFilter[];
}

export class CrossFilters {
    /// The column filters
    columnFilters: { [key: number]: CrossFilterPredicate };

    constructor() {
        this.columnFilters = {};
    }

    public clone(): CrossFilters {
        const copy = new CrossFilters();
        copy.columnFilters = {
            ...this.columnFilters
        };
        return copy;
    }

    public equals(other: CrossFilters): boolean {
        if (Object.keys(this.columnFilters).length != Object.keys(other.columnFilters).length) {
            return false;
        }
        for (const [key, a] of Object.entries(this.columnFilters)) {
            const bFilter = other.columnFilters[+key];
            if (bFilter === undefined || a.type != bFilter.type) {
                return false;
            }
            switch (a.type) {
                case HISTOGRAM_FILTER: {
                    const b = bFilter.value as HistogramFilterPredicate;
                    if (a.value.selection == null) {
                        if (b.selection != null) {
                            return false;
                        }
                    } else {
                        if (b.selection == null) {
                            return false;
                        }
                        if (
                            a.value.selection[0] != b.selection[0] ||
                            a.value.selection[1] != b.selection[1]
                        ) {
                            return false;
                        }
                    }
                    break;
                }
                case MOST_FREQUENT_FILTER: {
                    const b = bFilter.value as MostFrequentFilterPredicate;
                    if (a.value.valueId != b.valueId) {
                        return false;
                    }
                    break;
                }
            }
        }
        return true;
    }

    public createFilterTransforms(): ScalarFilter[] {
        const transforms: ScalarFilter[] = [];
        for (const v of Object.values(this.columnFilters)) {
            switch (v.type) {
                case HISTOGRAM_FILTER:
                    for (const filter of v.value.filters) {
                        transforms.push(filter);
                    }
                    break;
                case MOST_FREQUENT_FILTER:
                    for (const filter of v.value.filters) {
                        transforms.push(filter);
                    }
                    break;
            }
        }
        return transforms;
    }

    public containsHistogramFilter(columnGroupId: number, brush: [number, number] | null): boolean {
        const existing = this.columnFilters[columnGroupId];
        if (brush == null) {
            return existing === undefined;
        }
        if (existing === undefined || existing.type != HISTOGRAM_FILTER) {
            return false;
        }
        return existing.value.selection[0] == brush[0]
            && existing.value.selection[1] == brush[1];
    }

    public addHistogramFilter(columnGroupId: number, columnGroup: OrdinalGridColumnGroup, brush: [number, number] | null) {
        if (brush == null) {
            delete this.columnFilters[columnGroupId];
            return;
        }
        let filters: ScalarFilter[] = [];
        if (columnGroup.binFieldName != null && brush != null) {
            filters.push({ fieldName: columnGroup.binFieldName, op: ">=", value: brush[0] });
            filters.push({ fieldName: columnGroup.binFieldName, op: "<=", value: brush[1] });
        }
        this.columnFilters[columnGroupId] = {
            type: HISTOGRAM_FILTER,
            value: {
                selection: brush,
                filters,
            }
        };
    }

    public containsMostFrequentValueFilter(columnGroupId: number, valueId: number | null): boolean {
        const existing = this.columnFilters[columnGroupId];
        if (valueId == null) {
            return existing === undefined;
        }
        return existing?.type == MOST_FREQUENT_FILTER && existing.value.valueId == valueId;
    }

    public addMostFrequentValueFilter(columnGroupId: number, columnGroup: StringGridColumnGroup, valueId: number | null) {
        if (valueId == null) {
            delete this.columnFilters[columnGroupId];
            return;
        }
        if (columnGroup.valueIdFieldName == null) {
            return;
        }
        this.columnFilters[columnGroupId] = {
            type: MOST_FREQUENT_FILTER,
            value: {
                valueId,
                filters: [{ fieldName: columnGroup.valueIdFieldName, op: "=", value: valueId }],
            }
        };
    }
}
