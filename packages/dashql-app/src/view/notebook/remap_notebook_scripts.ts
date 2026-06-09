import { NotebookPage, NotebookPageScript, createPageScript } from '../../notebook/notebook_types.js';

export function remapNotebookPageScripts(
    pages: { [folderName: string]: NotebookPage },
    scriptMapping: Map<number, number>,
): { [folderName: string]: NotebookPage } {
    const out: { [folderName: string]: NotebookPage } = {};
    for (const folderName in pages) {
        const page = pages[folderName];
        const mappedScripts: { [fileName: string]: NotebookPageScript } = {};
        for (const fileName in page.scripts) {
            const script = page.scripts[fileName];
            const mapped = scriptMapping.get(script.scriptId);
            if (mapped !== undefined) {
                mappedScripts[script.fileName] = createPageScript(mapped, script.fileName);
            }
        }
        out[folderName] = {
            folderName: page.folderName,
            scripts: mappedScripts,
        };
    }
    return out;
}
