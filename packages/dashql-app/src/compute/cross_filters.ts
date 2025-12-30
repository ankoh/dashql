import * as buf from '@bufbuild/protobuf';
import * as pb from '@ankoh/dashql-protobuf';

import { VariantKind } from "../utils/variant.js";
import { OrdinalGridColumnGroup } from "./computation_types.js";

const HISTOGRAM_FILTER = Symbol("HISTOGRAM_FILTER");
const MOST_FREQUENT_FILTER = Symbol("MOST_FREQUENT_FILTER");

export type CrossFilterPredicate =
    | VariantKind<typeof HISTOGRAM_FILTER, HistogramFilterPredicate>
    | VariantKind<typeof MOST_FREQUENT_FILTER, MostFrequentFilterPredicate>
    ;

export interface HistogramFilterPredicate {
    /// The selection range
    selection: [number, number];
    /// The filter transforms
    filters: pb.dashql.compute.FilterTransform[];
}

export interface MostFrequentFilterPredicate {
    /// The index in the frequent value table
    frequentValueIndex: number;
}

export class CrossFilters {
    /// The column filters
    columnFilters: { [key: number]: CrossFilterPredicate };

    /// The constructor
    constructor() {
        this.columnFilters = {};
    }

    /// Clone the filters
    public clone(): CrossFilters {
        const copy = new CrossFilters();
        copy.columnFilters = {
            ...this.columnFilters
        };
        return copy;
    }

    /// Equals other cross-filters?
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
                }
                case MOST_FREQUENT_FILTER: {
                    // XXX Implement
                    return false;
                }
            }
        }
        return true;
    }

    /// Create the filter transforms
    public createFilterTransforms(): pb.dashql.compute.FilterTransform[] {
        const transforms: pb.dashql.compute.FilterTransform[] = [];
        for (const v of Object.values(this.columnFilters)) {
            switch (v.type) {
                case HISTOGRAM_FILTER:
                    for (const filter of v.value.filters) {
                        transforms.push(filter);
                    }
                    break;
                case MOST_FREQUENT_FILTER:
                    break;
            }
        }
        return transforms;
    }

    /// Contains a histogram filter?
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

    /// Update the column filters
    public addHistogramFilter(columnGroupId: number, columnGroup: OrdinalGridColumnGroup, brush: [number, number] | null) {
        if (brush == null) {
            delete this.columnFilters[columnGroupId];
            return;
        }
        let filters: pb.dashql.compute.FilterTransform[] = [];
        if (columnGroup.binFieldName != null && brush != null) {
            filters.push(buf.create(pb.dashql.compute.FilterTransformSchema, {
                fieldName: columnGroup.binFieldName,
                operator: pb.dashql.compute.FilterOperator.GreaterEqualLiteral,
                literalDouble: brush[0]
            }));
            filters.push(buf.create(pb.dashql.compute.FilterTransformSchema, {
                fieldName: columnGroup.binFieldName,
                operator: pb.dashql.compute.FilterOperator.LessEqualLiteral,
                literalDouble: brush[1]
            }));
        }
        this.columnFilters[columnGroupId] = {
            type: HISTOGRAM_FILTER,
            value: {
                selection: brush,
                filters,
            }
        };
    }
}
