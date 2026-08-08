import { ScriptFolder, ScriptRef, createScriptRef } from '../../scripts/script_types.js';

export function remapScriptRefs(
    pages: { [folderName: string]: ScriptFolder },
    scriptMapping: Map<number, number>,
): { [folderName: string]: ScriptFolder } {
    const out: { [folderName: string]: ScriptFolder } = {};
    for (const folderName in pages) {
        const page = pages[folderName];
        const mappedScripts: { [fileName: string]: ScriptRef } = {};
        for (const fileName in page.scripts) {
            const script = page.scripts[fileName];
            const mapped = scriptMapping.get(script.scriptId);
            if (mapped !== undefined) {
                mappedScripts[script.fileName] = createScriptRef(mapped, script.fileName);
            }
        }
        out[folderName] = {
            folderName: page.folderName,
            scripts: mappedScripts,
        };
    }
    return out;
}
