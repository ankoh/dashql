import type { TopLevelSpec } from 'vega-lite';

import { renderVegaLitePng } from './vegalite_image.js';

// The rows replace the data of the spec
const SPEC: TopLevelSpec = {
    data: { name: 'rows' },
    mark: 'bar',
    encoding: {
        x: { field: 'k', type: 'nominal' },
        y: { field: 'v', type: 'quantitative' },
    },
};

const ROWS = [{ k: 'a', v: 1 }, { k: 'b', v: 3 }, { k: 'c', v: 2 }];

/// The pixels of a PNG
async function decode(png: Uint8Array): Promise<ImageData> {
    const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

describe('renderVegaLitePng', () => {
    it('renders a chart as PNG at 800x500 with scale 2 on a white background', async () => {
        const image = await renderVegaLitePng(SPEC, ROWS);
        expect([image.width, image.height]).toEqual([1600, 1000]);
        expect(Array.from(image.png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const pixels = await decode(image.png);
        expect([pixels.width, pixels.height]).toEqual([1600, 1000]);
        // The top right corner is background, the bars are drawn in other colors
        expect(Array.from(pixels.data.subarray((pixels.width - 1) * 4, pixels.width * 4))).toEqual([255, 255, 255, 255]);
        const colors = new Set<number>();
        for (let i = 0; i < pixels.data.length; i += 4) colors.add(pixels.data[i] << 16 | pixels.data[i + 1] << 8 | pixels.data[i + 2]);
        expect(colors.size).toBeGreaterThan(2);
    });

    it('renders at the given size and scale', async () => {
        const image = await renderVegaLitePng(SPEC, ROWS, { width: 300, height: 200, scale: 1 });
        expect([image.width, image.height]).toEqual([300, 200]);
    });

    it('rejects specs that do not compile', async () => {
        await expect(renderVegaLitePng({ mark: 'nope' } as unknown as TopLevelSpec, ROWS)).rejects.toThrow();
    });
});
