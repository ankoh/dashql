// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function isSubset(left: any, right: any): boolean {
    if (left === right) return true;
    if (typeof left !== typeof right) return false;
    if (Object(left) !== left) return false;
    for (const key in left) {
        const lv = left[key];
        const rv = right[key];
        if (!rv || !isSubset(lv, rv)) return false;
    }
    return true;
}
