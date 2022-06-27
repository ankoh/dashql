// Copyright (c) 2021 The DashQL Authors

interface Indexable<ValueType> {
    [index: number]: ValueType;
}

export function lowerBound<ValueType, ArrayType extends Indexable<ValueType>>(
    values: ArrayType,
    target: ValueType,
    isLess: (l: ValueType, r: ValueType) => boolean,
    lb: number,
    ub: number,
): number {
    let count = ub - lb;
    while (count > 0) {
        const step = count >>> 1;
        const it = lb + step;
        if (isLess(values[it], target)) {
            lb = it + 1;
            count -= step + 1;
        } else {
            count = step;
        }
    }
    return lb;
}
