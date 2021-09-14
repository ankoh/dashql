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

export const regrSlopeF64 = (col: arrow.Column): number => {
    const n = col.length;
    let sumXY = 0;
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let row = 0;
    for (const value of col) {
        const y = value;
        sumXY += row * y;
        sumX += row;
        sumY += y;
        sumX2 += row * row;
        row += 1;
    }
    const slope = Number(n * sumXY - sumX * sumY) / Number(n * sumX2 - sumX * sumX);
    return slope;
};
