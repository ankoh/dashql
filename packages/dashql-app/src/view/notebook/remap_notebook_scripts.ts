import * as pb from '../../proto.js';
import * as buf from "@bufbuild/protobuf";

export function remapNotebookPageScripts(pages: pb.dashql.notebook.NotebookPage[], scriptMapping: Map<number, number>) {
    // Restore pages: use notebook_pages from proto; if empty, create one default page
    const out: pb.dashql.notebook.NotebookPage[] = [];
    if (pages.length > 0) {
        // Map script ids in notebook pages
        for (const page of pages) {
            const p = buf.create(pb.dashql.notebook.NotebookPageSchema, {});
            for (const script of page.scripts) {
                const mapped = scriptMapping.get(script.scriptId);
                if (mapped !== undefined) {
                    const s = buf.create(pb.dashql.notebook.NotebookPageScriptSchema, {
                        scriptId: mapped,
                    });
                    p.scripts.push(s);
                }
            }
            if (p.scripts.length > 0) {
                out.push(p);
            }
        }
    }
    return out;
}
