import * as pb from '../../proto.js';
import * as buf from "@bufbuild/protobuf";

export function remapNotebookPageScripts(pages: pb.dashql.notebook.NotebookPage[], scriptMapping: Map<number, number>) {
    // Restore pages: use notebook_pages from proto; if empty, create one default page
    const out: pb.dashql.notebook.NotebookPage[] = [];
    if (pages.length > 0) {
        // Map script ids in notebook pages
        for (const page of pages) {
            const mappedScripts: pb.dashql.notebook.NotebookPageScript[] = [];
            for (const script of page.scripts) {
                const mapped = scriptMapping.get(script.scriptId);
                if (mapped !== undefined) {
                    mappedScripts.push(buf.create(pb.dashql.notebook.NotebookPageScriptSchema, {
                        scriptId: mapped,
                        title: script.title,
                    }));
                }
            }
            const p = buf.create(pb.dashql.notebook.NotebookPageSchema, {
                scripts: mappedScripts,
            });
            out.push(p);
        }
    }
    return out;
}
