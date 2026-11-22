import { CsvSniffer } from './index.js';

let sniffer: CsvSniffer | null = null;
beforeAll(async () => {
    sniffer = await CsvSniffer.create();
});

/// The text of a blob
const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

describe('the CSV sniffer', () => {
    it('scans a file in chunks and finds its format, its columns and its data', async () => {
        const file = new Blob([
            '# exported by a tool\n',
            'id;name;price;day\n',
            ...Array.from({ length: 40 }, (_, i) => `${i};item ${i};${i}.25;2024-03-${String(i % 28 + 1).padStart(2, '0')}\n`),
            '\n\n',
        ]);
        const progress: number[] = [];
        const scan = await sniffer!.scan(file, { chunkBytes: 64, onProgress: read => progress.push(read) });
        try {
            expect(scan.format).toMatchObject({ encoding: 'UTF-8', transcoded: false, delimiter: ';', quote: '"', hasHeader: true, columns: 4 });
            expect(scan.format.dataOffset).toBe('# exported by a tool\n'.length);
            expect(scan.schema.columns.map(c => [c.name, c.type])).toEqual([
                ['id', 'BIGINT'], ['name', 'TEXT'], ['price', 'DOUBLE PRECISION'], ['day', 'DATE'],
            ]);
            expect(scan.schema.rows).toBe(40);
            expect(scan.schema.problems).toEqual([]);
            expect(scan.schema.preview[1]).toEqual(['1', 'item 1', '1.25', '2024-03-02']);
            // The progress counts up to the size of the file
            expect(progress.at(-1)).toBe(file.size);
            expect(progress.length).toBe(Math.ceil(file.size / 64));
            // The data starts at the header and leaves the blank lines at the end out
            const data = await text(scan.data);
            expect(data.startsWith('id;name;price;day\n0;item 0;')).toBe(true);
            expect(data.endsWith('39;item 39;39.25;2024-03-12\n')).toBe(true);
            expect(scan.selectQuery('/mnt/a.csv')).toContain(`columns => descriptor("id" BIGINT, "name" TEXT, "price" DOUBLE PRECISION, "day" DATE)`);
        } finally {
            scan.release();
        }
        expect(() => scan.selectQuery('/mnt/a.csv')).toThrow('released');
    });

    it('decodes a file that is no UTF-8', async () => {
        // "Größe" in windows-1252
        const bytes = new Uint8Array([...new TextEncoder().encode('Name,Gr'), 0xF6, 0xDF, ...new TextEncoder().encode('e\nA,1\nB,2\nC,3\n')]);
        const scan = await sniffer!.scan(new Blob([bytes]), { chunkBytes: 3 });
        try {
            expect(scan.format.transcoded).toBe(true);
            expect(scan.schema.columns.map(c => c.name)).toEqual(['Name', 'Größe']);
            expect(await text(scan.data)).toBe('Name,Größe\nA,1\nB,2\nC,3\n');
        } finally {
            scan.release();
        }
    });

    it('tells the rows that Hyper cannot read', async () => {
        const scan = await sniffer!.scan(new Blob(['a,b,c\n1,2,3\n4,5,6\n7,8\n9,10,11\n12,13,14\n']));
        try {
            expect(scan.schema.problems).toEqual([
                '1 row of 5 has another number of fields than the 3 columns, the first is row 3. Hyper can\'t read these rows.',
            ]);
        } finally {
            scan.release();
        }
    });

    it('stops a scan that is aborted', async () => {
        const controller = new AbortController();
        const scan = sniffer!.scan(new Blob(['a,b\n'.repeat(100)]), { chunkBytes: 16, signal: controller.signal, onProgress: () => controller.abort() });
        await expect(scan).rejects.toThrow(/abort/i);
    });
});
