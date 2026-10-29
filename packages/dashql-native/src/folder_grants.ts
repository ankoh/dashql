import {access, lstat, readFile, realpath, rename, writeFile} from "node:fs/promises";
import path from "node:path";

/// The files that mark a session folder: `STORAGE_SESSION_FILE` of the app and its name before sessions were renamed
export const SESSION_FILES = ["dashql-session.json", "dashql-notebook.json"];

/// The folders that the renderer may access through `dashql:fs`.
///
/// The user grants a folder by picking it in a directory dialog of the main process, the renderer cannot add one
/// on its own. The grants are a JSON list of real paths in the user data folder.
///
/// Storage written before the grants existed refers to its session folders by path. The renderer claims them
/// once: a claim is accepted only while the grants file did not exist when the app started, and only for a folder
/// that holds a session file.
export class FolderGrants {
    /// The saves, one after the other
    private saving: Promise<void> = Promise.resolve();

    private constructor(
        private readonly file: string,
        private readonly roots: Set<string>,
        private readonly claimsOpen: boolean,
    ) {}

    /// Load the grants, a missing file opens the claims of existing session folders
    static async load(file: string): Promise<FolderGrants> {
        let text: string;
        try {
            text = await readFile(file, "utf8");
        } catch (error) {
            if (isMissing(error)) return new FolderGrants(file, new Set(), true);
            throw error;
        }
        const parsed = JSON.parse(text) as unknown;
        const roots = Array.isArray(parsed) ? parsed.filter((root): root is string => typeof root === "string" && path.isAbsolute(root)) : [];
        return new FolderGrants(file, new Set(roots), false);
    }

    /// Grant a folder that the user picked
    async grant(folder: string): Promise<void> {
        const root = await realpath(folder);
        if (this.roots.has(root)) return;
        this.roots.add(root);
        await this.save();
    }

    /// Grant a session folder that the storage registered before the grants existed
    async claimSessionFolder(folder: string): Promise<boolean> {
        if (!this.claimsOpen || !path.isAbsolute(folder)) return false;
        let root: string;
        try {
            root = await realpath(folder);
        } catch {
            return false;
        }
        const marked = await Promise.all(SESSION_FILES.map(file => access(path.join(root, file)).then(() => true, () => false)));
        if (!marked.includes(true)) return false;
        if (!this.roots.has(root)) {
            this.roots.add(root);
            await this.save();
        }
        return true;
    }

    /// The real path of a target in a granted folder, null if the target is outside of every granted folder.
    /// Symbolic links are resolved, a link in a granted folder cannot lead out of it.
    async resolve(target: string): Promise<string | null> {
        const real = await realTarget(path.resolve(target));
        for (const root of this.roots) {
            const relative = path.relative(root, real);
            if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return real;
        }
        return null;
    }

    /// Is a real path a granted folder itself?
    isRoot(real: string): boolean {
        return this.roots.has(real);
    }

    private save(): Promise<void> {
        const roots = [...this.roots];
        this.saving = this.saving.catch(() => {}).then(async () => {
            const temporary = `${this.file}.tmp`;
            await writeFile(temporary, JSON.stringify(roots, null, 2));
            await rename(temporary, this.file);
        });
        return this.saving;
    }
}

/// The real path of a target that may not exist yet, e.g. a file that is about to be written
async function realTarget(target: string): Promise<string> {
    const missing: string[] = [];
    let existing = target;
    for (;;) {
        try {
            return path.join(await realpath(existing), ...missing);
        } catch (error) {
            const parent = path.dirname(existing);
            if (!isMissing(error) || parent === existing) throw error;
            // A dangling link is missing too, but writing through it would create its target
            if (await lstat(existing).then(() => true, () => false)) throw new Error("Rejected dangling link");
            missing.unshift(path.basename(existing));
            existing = parent;
        }
    }
}

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}
