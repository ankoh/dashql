import { describe, it, expect } from 'vitest';
import { disambiguatePaths } from './path_disambiguation.js';

describe('disambiguatePaths', () => {
    it('should handle empty array', () => {
        const result = disambiguatePaths([]);
        expect(result).toEqual([]);
    });

    it('should show just basename when paths are unique', () => {
        const result = disambiguatePaths([
            '/a/b/c/file1',
            '/x/y/z/file2',
        ]);

        expect(result[0].displayPath).toBe('file1');
        expect(result[1].displayPath).toBe('file2');
    });

    it('should add parent directory when basenames collide', () => {
        const result = disambiguatePaths([
            '/a/b/c/file',
            '/x/y/c/file',
        ]);

        expect(result[0].displayPath).toBe('…/b/c/file');
        expect(result[1].displayPath).toBe('…/y/c/file');
    });

    it('should handle three-way collisions', () => {
        const result = disambiguatePaths([
            '/a/b/file',
            '/a/c/file',
            '/x/c/file',
        ]);

        expect(result[0].displayPath).toBe('…/b/file');
        expect(result[1].displayPath).toBe('…/a/c/file');
        expect(result[2].displayPath).toBe('…/x/c/file');
    });

    it('should handle paths with different depths', () => {
        const result = disambiguatePaths([
            '/a/file',
            '/x/y/z/file',
        ]);

        expect(result[0].displayPath).toBe('…/a/file');
        expect(result[1].displayPath).toBe('…/z/file');
    });

    it('should show full path when all segments are needed', () => {
        const result = disambiguatePaths([
            '/a/b/c',
            '/a/b/d',
        ]);

        expect(result[0].displayPath).toBe('c');
        expect(result[1].displayPath).toBe('d');
    });

    it('should handle UUIDs (common session path format)', () => {
        const result = disambiguatePaths([
            '550e8400-e29b-41d4-a716-446655440000',
            '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
        ]);

        // UUIDs have no path separator, so each should be unique as-is
        expect(result[0].displayPath).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(result[1].displayPath).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
        expect(result[2].displayPath).toBe('6ba7b811-9dad-11d1-80b4-00c04fd430c8');
    });

    it('should handle paths with folder structure and UUIDs', () => {
        const result = disambiguatePaths([
            'opfs://sessions/project-a/550e8400-e29b-41d4-a716-446655440000',
            'opfs://sessions/project-b/550e8400-e29b-41d4-a716-446655440000',
        ]);

        expect(result[0].displayPath).toBe('opfs://…/project-a/550e8400-e29b-41d4-a716-446655440000');
        expect(result[1].displayPath).toBe('opfs://…/project-b/550e8400-e29b-41d4-a716-446655440000');
    });

    it('should track segment count correctly', () => {
        const result = disambiguatePaths([
            '/a/b/c/file',
            '/x/y/c/file',
        ]);

        expect(result[0].segmentCount).toBe(3); // b/c/file
        expect(result[1].segmentCount).toBe(3); // y/c/file
    });

    it('should preserve schema prefix when truncating', () => {
        const result = disambiguatePaths([
            'opfs://a/b/c/file',
            'opfs://x/y/c/file',
        ]);

        expect(result[0].displayPath).toBe('opfs://…/b/c/file');
        expect(result[1].displayPath).toBe('opfs://…/y/c/file');
    });
});
