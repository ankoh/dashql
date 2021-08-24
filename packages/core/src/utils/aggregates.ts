import * as arrow from 'apache-arrow';

export const regrSlopeBigInt = (col: arrow.Column): number => {
    const n = BigInt(col.length);
    let sumXY = BigInt(0);
    let sumX = BigInt(0);
    let sumY = BigInt(0);
    let sumX2 = BigInt(0);
    let row = BigInt(0);
    for (const value of col) {
        const y = BigInt(value);
        sumXY += row * y;
        sumX += row;
        sumY += y;
        sumX2 += row * row;
        row += BigInt(1);
    }
    const slope = Number(n * sumXY - sumX * sumY) / Number(n * sumX2 - sumX * sumX);
    return slope;
};
