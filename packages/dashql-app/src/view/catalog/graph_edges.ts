export enum EdgeType {
    // Angle is multiple of 90
    West = 0,
    South = 1,
    East = 2,
    North = 3,
    // dy >= dx
    SouthWest = 4,
    SouthEast = 5,
    NorthEast = 6,
    NorthWest = 7,
    // dx > dy
    WestSouth = 8,
    EastSouth = 9,
    EastNorth = 10,
    WestNorth = 11,
    // dy >= dx && dx < width
    SouthWestSouth = 12,
    SouthEastSouth = 13,
    NorthEastNorth = 14,
    NorthWestNorth = 15,
    // dx > dy && dy < height
    WestSouthWest = 16,
    EastSouthEast = 17,
    EastNorthEast = 18,
    WestNorthWest = 19,
}

export enum NodePort {
    North = 0b0001,
    East = 0b0010,
    South = 0b0100,
    West = 0b1000,
}

export const PORTS_FROM = new Uint8Array([
    NodePort.West,
    NodePort.South,
    NodePort.East,
    NodePort.North,
    NodePort.South,
    NodePort.South,
    NodePort.North,
    NodePort.North,
    NodePort.West,
    NodePort.East,
    NodePort.East,
    NodePort.West,
    NodePort.South,
    NodePort.South,
    NodePort.North,
    NodePort.North,
    NodePort.West,
    NodePort.East,
    NodePort.East,
    NodePort.West,
]);

export const PORTS_TO = new Uint8Array([
    NodePort.East,
    NodePort.North,
    NodePort.West,
    NodePort.South,
    NodePort.East,
    NodePort.West,
    NodePort.West,
    NodePort.East,
    NodePort.North,
    NodePort.North,
    NodePort.South,
    NodePort.South,
    NodePort.North,
    NodePort.North,
    NodePort.South,
    NodePort.South,
    NodePort.East,
    NodePort.West,
    NodePort.West,
    NodePort.East,
]);

/// Atan2 circle https://commons.wikimedia.org/wiki/File:Atan2_circle.svg
export function selectEdgeTypeFromAngle(angle: number): EdgeType {
    const sector = angle / 90; // [-2, 2[
    if (sector == Math.floor(sector)) {
        // One of [-2, -1, 0, 1, 2]
        //
        // Becomes:
        //   West = 0,
        //   South = 1,
        //   East = 2,
        //   North = 3,
        return (sector + 2) as EdgeType; // [0, 4[
    } else {
        // We round the value, use the subsequent sector
        //
        // Becomes:
        //   SouthWest = 4,
        //   SouthEast = 5,
        //   NorthEast = 6,
        //   NorthWest = 7,
        return (Math.floor(sector) + 2 + 4) as EdgeType; // [4, 8[
    }
}

/// Select edge type using node dimensions
export function selectEdgeType(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number,
    height: number,
): EdgeType {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    let orientation = selectEdgeTypeFromAngle(angle);
    // const boxWidth = (widthX + widthY) / 2;
    // const boxHeight = (heightX + heightY) / 2;
    const boxDx = Math.max(Math.abs(dx), width) - width;
    const boxDy = Math.max(Math.abs(dy), height) - height;
    if (orientation >= 4) {
        // Is the horizontal distance larger than vertical?
        // Horizontal -> East/West first
        // Vertical   -> North/South first
        if (boxDx > boxDy) {
            orientation += 4; // [8, 12[

            // If dy < boxHeight, we cannot render like:
            //   |
            //   +--
            // but have to render like:
            //   --+
            //     |
            //     +--
            //
            if (Math.abs(dy) < height) {
                orientation += 8; // [16, 20[
            }
        } else {
            // If dx < boxWidth, we cannot render like:
            //   --+
            //     |
            // but have to render like:
            //     |
            //     +-+
            //       |
            //
            if (Math.abs(dx) < width) {
                orientation += 8; // [12, 16[
            }
        }
    }
    return orientation;
}

/// Select horizontal edge type using node dimensions
export function selectHorizontalEdgeType(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
): EdgeType {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    let orientation = selectEdgeTypeFromAngle(angle);
    if (orientation >= 4) {
        return orientation + 12; // [16, 20[
    } else {
        return orientation;
    }
}

export class EdgePathBuilder {
    path: Float64Array;
    i: number;
    constructor() {
        this.path = new Float64Array(16);
        this.i = 0;
    }
    reset() {
        for (let i = 0; i < 16; ++i) {
            this.path[i] = 0;
        }
        this.i = 0;
    }
    begin(x: number, y: number) {
        this.reset();
        this.path[0] = x;
        this.path[1] = y;
    }
    push(x: number, y: number) {
        this.i += 2;
        this.path[this.i] = x;
        this.path[this.i + 1] = y;
    }
    buildDirect(): string {
        const p = this.path;
        return `M ${p[0]} ${p[1]} L ${p[2]} ${p[3]}`;
    }
    build1Turn(): string {
        const p = this.path;
        return `M ${p[0]} ${p[1]} L ${p[2]} ${p[3]} Q ${p[4]} ${p[5]}, ${p[6]} ${p[7]} L ${p[8]} ${p[9]}`;
    }
    build2Turns(): string {
        const p = this.path;
        return `M ${p[0]} ${p[1]} L ${p[2]} ${p[3]} Q ${p[4]} ${p[5]}, ${p[6]} ${p[7]} L ${p[8]} ${p[9]} Q ${p[10]} ${p[11]}, ${p[12]} ${p[13]} L ${p[14]} ${p[15]}`;
    }
}

export function buildEdgePath(
    builder: EdgePathBuilder,
    type: EdgeType,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    fromWidth: number,
    fromHeight: number,
    toWidth: number,
    toHeight: number,
    cornerRadius: number,
): string {
    if (toX - fromX == 0 && toY - fromY == 0) {
        return '';
    }
    const r = cornerRadius;

    // Note that North/South/East/West is a bit confusing here in the context of SVG:
    //  - We use North as North relative to the target coordinate system.
    //  - That means North == Larger Y, South == Smaller Y
    //  - This breaks intuition in SVG since there (0, 0) is in the top-left!
    //  - In SVG, don't assume that NORTH means an edge is going upwards!

    switch (type) {
        // DIRECT

        case EdgeType.North:
            builder.begin(fromX, fromY + fromHeight / 2);
            builder.push(toX, toY - toHeight / 2);
            return builder.buildDirect();

        case EdgeType.South:
            builder.begin(fromX, fromY - fromHeight / 2);
            builder.push(toX, toY + toHeight / 2);
            return builder.buildDirect();

        case EdgeType.East:
            builder.begin(fromX + fromWidth / 2, fromY);
            builder.push(toX - toWidth / 2, toY);
            return builder.buildDirect();

        case EdgeType.West:
            builder.begin(fromX - fromWidth / 2, fromY);
            builder.push(toX + toWidth / 2, toY);
            return builder.buildDirect();

        // 1 TURN

        //  +-B
        //  |
        //  A
        case EdgeType.NorthEast: {
            fromY += fromHeight / 2;
            toX -= toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(fromX, toY - Math.min(diffY / 2, r) - r);
            builder.push(fromX, toY);
            builder.push(fromX + Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //  B-+
        //    |
        //    A
        case EdgeType.NorthWest: {
            fromY += fromHeight / 2;
            toX += toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(fromX, toY - Math.min(diffY / 2, r));
            builder.push(fromX, toY);
            builder.push(fromX - Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //  A
        //  |
        //  +-B
        case EdgeType.SouthEast: {
            fromY += fromHeight / 2;
            toX -= toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(fromX, toY + Math.min(diffY / 2, r));
            builder.push(fromX, toY);
            builder.push(fromX + Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //    A
        //    |
        //  B-+
        case EdgeType.SouthWest: {
            fromY -= fromHeight / 2;
            toX += toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(fromX, toY + Math.min(diffY / 2, r));
            builder.push(fromX, toY);
            builder.push(fromX - Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //    B
        //    |
        //  A-+
        case EdgeType.EastNorth: {
            fromX += fromWidth / 2;
            toY -= toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(toX - Math.min(diffX / 2, r), fromY);
            builder.push(toX, fromY);
            builder.push(toX, fromY + Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //  A-+
        //    |
        //    B
        case EdgeType.EastSouth: {
            fromX += fromWidth / 2;
            toY += toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(toX - Math.min(diffX / 2, r), fromY);
            builder.push(toX, fromY);
            builder.push(toX, fromY - Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //  B
        //  |
        //  +-A
        case EdgeType.WestNorth: {
            fromX -= fromWidth / 2;
            toY -= toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(toX + Math.min(diffX / 2, r), fromY);
            builder.push(toX, fromY);
            builder.push(toX, fromY + Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        //  +-A
        //  |
        //  B
        case EdgeType.WestSouth: {
            fromX -= fromWidth / 2;
            toY += toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            builder.begin(fromX, fromY);
            builder.push(toX + Math.min(diffX / 2, r), fromY);
            builder.push(toX, fromY);
            builder.push(toX, fromY - Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build1Turn();
        }

        // 2 TURNS

        //   +-B
        //   |
        // A-+
        case EdgeType.EastNorthEast: {
            fromX += fromWidth / 2;
            toX -= toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midX = fromX + diffX / 2;
            builder.begin(fromX, fromY);
            builder.push(midX - Math.min(diffX / 2, r), fromY);
            builder.push(midX, fromY);
            builder.push(midX, fromY + Math.min(diffY / 2, r));
            builder.push(midX, toY - Math.min(diffY / 2, r));
            builder.push(midX, toY);
            builder.push(midX + Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        // A-+
        //   |
        //   +-B
        case EdgeType.EastSouthEast: {
            fromX += fromWidth / 2;
            toX -= toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midX = fromX + diffX / 2;
            builder.begin(fromX, fromY);
            builder.push(midX - Math.min(diffX / 2, r), fromY);
            builder.push(midX, fromY);
            builder.push(midX, fromY - Math.min(diffY / 2, r));
            builder.push(midX, toY + Math.min(diffY / 2, r));
            builder.push(midX, toY);
            builder.push(midX + Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        // A
        // |
        // +-+
        //   |
        //   B
        case EdgeType.SouthEastSouth: {
            fromY -= fromHeight / 2;
            toY += toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midY = fromY - diffY / 2;
            builder.begin(fromX, fromY);
            builder.push(fromX, midY + Math.min(diffY / 2, r));
            builder.push(fromX, midY);
            builder.push(fromX + Math.min(diffX / 2, r), midY);
            builder.push(toX - Math.min(diffX / 2, r), midY);
            builder.push(toX, midY);
            builder.push(toX, midY - Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        //   A
        //   |
        // +-+
        // |
        // B
        case EdgeType.SouthWestSouth: {
            fromY -= fromHeight / 2;
            toY += toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midY = fromY - diffY / 2;
            builder.begin(fromX, fromY);
            builder.push(fromX, midY + Math.min(diffY / 2, r));
            builder.push(fromX, midY);
            builder.push(fromX - Math.min(diffX / 2, r), midY);
            builder.push(toX + Math.min(diffX / 2, r), midY);
            builder.push(toX, midY);
            builder.push(toX, midY - Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        // B-+
        //   |
        //   +-A
        case EdgeType.WestNorthWest: {
            fromX -= fromWidth / 2;
            toX += toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midX = fromX - diffX / 2;
            builder.begin(fromX, fromY);
            builder.push(midX + Math.min(diffX / 2, r), fromY);
            builder.push(midX, fromY);
            builder.push(midX, fromY + Math.min(diffY / 2, r));
            builder.push(midX, toY - Math.min(diffY / 2, r));
            builder.push(midX, toY);
            builder.push(midX - Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        //   +-A
        //   |
        // B-+
        case EdgeType.WestSouthWest: {
            fromX -= fromWidth / 2;
            toX += toWidth / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midX = fromX - diffX / 2;
            builder.begin(fromX, fromY);
            builder.push(midX + Math.min(diffX / 2, r), fromY);
            builder.push(midX, fromY);
            builder.push(midX, fromY - Math.min(diffY / 2, r));
            builder.push(midX, toY + Math.min(diffY / 2, r));
            builder.push(midX, toY);
            builder.push(midX - Math.min(diffX / 2, r), toY);
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        //   B
        //   |
        // +-+
        // |
        // A
        case EdgeType.NorthEastNorth: {
            fromY += fromHeight / 2;
            toY -= toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midY = fromY + diffY / 2;
            builder.begin(fromX, fromY);
            builder.push(fromX, midY - Math.min(diffY / 2, r));
            builder.push(fromX, midY);
            builder.push(fromX + Math.min(diffX / 2, r), midY);
            builder.push(toX - Math.min(diffX / 2, r), midY);
            builder.push(toX, midY);
            builder.push(toX, midY + Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build2Turns();
        }

        // B
        // |
        // +-+
        //   |
        //   A
        case EdgeType.NorthWestNorth: {
            fromY += fromHeight / 2;
            toY -= toHeight / 2;
            const diffX = Math.abs(toX - fromX);
            const diffY = Math.abs(toY - fromY);
            const midY = fromY + diffY / 2;
            builder.begin(fromX, fromY);
            builder.push(fromX, midY - Math.min(diffY / 2, r));
            builder.push(fromX, midY);
            builder.push(fromX - Math.min(diffX / 2, r), midY);
            builder.push(toX + Math.min(diffX / 2, r), midY);
            builder.push(toX, midY);
            builder.push(toX, midY + Math.min(diffY / 2, r));
            builder.push(toX, toY);
            return builder.build2Turns();
        }
    }
}
