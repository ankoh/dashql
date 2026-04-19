/**
 * Disambiguate a list of paths by computing the minimum number of path segments
 * needed to make each path unique.
 *
 * For example:
 * - ["/a/b/c/file1", "/x/y/z/file2"] -> ["file1/", "file2/"]
 * - ["/a/b/c/file", "/x/y/c/file"] -> ["…/c/file/", "…/c/file/"] (if only showing 2 segments)
 * - ["/a/b/file", "/a/c/file", "/x/c/file"] -> ["b/file/", "…/c/file/", "…/c/file/"] (if segments cut)
 */

interface PathEntry {
    fullPath: string;
    schemaPrefix: string;
    segments: string[];
}

export interface DisambiguatedPath {
    fullPath: string;
    displayPath: string;
    segmentCount: number;
}

/**
 * Split a path into schema prefix and segments
 * e.g., "opfs://sessions/uuid" -> { prefix: "opfs://", segments: ["sessions", "uuid"] }
 */
function splitPath(path: string): { prefix: string; segments: string[] } {
    // Check if path has a schema prefix (e.g., "opfs://", "file://")
    const schemaMatch = path.match(/^([a-z]+:\/\/)/);
    const prefix = schemaMatch ? schemaMatch[1] : '';
    const pathWithoutSchema = prefix ? path.substring(prefix.length) : path;
    const segments = pathWithoutSchema.split('/').filter(s => s.length > 0);

    return { prefix, segments };
}

/**
 * Get the last N segments of a path as a joined string with trailing slash.
 * Prepends "…" (ellipsis) if not showing all segments, preserving the schema prefix.
 */
function getPathSuffix(schemaPrefix: string, segments: string[], count: number): string {
    const start = Math.max(0, segments.length - count);
    const path = segments.slice(start).join('/');
    const truncated = count < segments.length;
    const pathPart = truncated ? `…/${path}/` : `${path}/`;
    return schemaPrefix + pathPart;
}

/**
 * Compute disambiguated paths for a list of full paths
 */
export function disambiguatePaths(paths: string[]): DisambiguatedPath[] {
    if (paths.length === 0) {
        return [];
    }

    // Parse all paths into schema prefix and segments
    const entries: PathEntry[] = paths.map(fullPath => {
        const { prefix, segments } = splitPath(fullPath);
        return {
            fullPath,
            schemaPrefix: prefix,
            segments,
        };
    });

    // Track the number of segments needed for each path
    const segmentCounts = new Map<string, number>();

    // Initialize all paths to use just 1 segment (the basename)
    for (const entry of entries) {
        segmentCounts.set(entry.fullPath, 1);
    }

    // Iteratively increase segment count for colliding paths
    let hasCollisions = true;
    const maxIterations = Math.max(...entries.map(e => e.segments.length));

    for (let iteration = 0; iteration < maxIterations && hasCollisions; iteration++) {
        hasCollisions = false;

        // Build a map of displayPath -> list of fullPaths that produce that display
        const displayPathMap = new Map<string, string[]>();

        for (const entry of entries) {
            const segmentCount = segmentCounts.get(entry.fullPath)!;
            const displayPath = getPathSuffix(entry.schemaPrefix, entry.segments, segmentCount);

            if (!displayPathMap.has(displayPath)) {
                displayPathMap.set(displayPath, []);
            }
            displayPathMap.get(displayPath)!.push(entry.fullPath);
        }

        // Find collisions and increase segment count for those paths
        for (const [displayPath, fullPaths] of displayPathMap) {
            if (fullPaths.length > 1) {
                hasCollisions = true;

                // Increase segment count for all colliding paths
                for (const fullPath of fullPaths) {
                    const entry = entries.find(e => e.fullPath === fullPath)!;
                    const currentCount = segmentCounts.get(fullPath)!;

                    // Only increase if we have more segments available
                    if (currentCount < entry.segments.length) {
                        segmentCounts.set(fullPath, currentCount + 1);
                    }
                }
            }
        }
    }

    // Build final result
    return entries.map(entry => {
        const segmentCount = segmentCounts.get(entry.fullPath)!;
        const displayPath = getPathSuffix(entry.schemaPrefix, entry.segments, segmentCount);

        return {
            fullPath: entry.fullPath,
            displayPath,
            segmentCount,
        };
    });
}

/**
 * Compute disambiguated paths from a map of identifier -> path
 * Returns a map of identifier -> disambiguated display path
 */
export function disambiguatePathMap<T extends string>(
    pathMap: Map<T, string>
): Map<T, DisambiguatedPath> {
    const identifiers = Array.from(pathMap.keys());
    const paths = identifiers.map(id => pathMap.get(id)!);
    const disambiguated = disambiguatePaths(paths);

    const result = new Map<T, DisambiguatedPath>();
    for (let i = 0; i < identifiers.length; i++) {
        result.set(identifiers[i], disambiguated[i]);
    }

    return result;
}
