import { NotebookPage, NotebookPageScript, createPageScript } from '../../notebook/notebook_types.js';

export function remapNotebookPageScripts(pages: NotebookPage[], scriptMapping: Map<number, number>) {
    // Restore pages: use notebook_pages from proto; if empty, create one default page
    const out: NotebookPage[] = [];
    if (pages.length > 0) {
        // Map script ids in notebook pages
        for (const page of pages) {
            const mappedScripts: NotebookPageScript[] = [];
            for (const script of page.scripts) {
                const mapped = scriptMapping.get(script.scriptId);
                if (mapped !== undefined) {
                    mappedScripts.push(createPageScript(mapped, script.title));
                }
            }
            const p = {
                scripts: mappedScripts,
            };
            out.push(p);
        }
    }
    return out;
}
