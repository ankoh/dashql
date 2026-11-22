import * as React from 'react';
import * as dashql from '@akohn/dashql';

import type { EditorView } from '@codemirror/view';

import { CodeIcon, DatabaseIcon } from '@akohn/dashql-react/components/symbol_icon';
import { type Logger, stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useDashQLCore } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { DEFAULT_FORMAT_WIDTH } from '../../workbook/scripts/script_format.js';
import { formatScriptEditor } from '../../workbook/editor/script_format_editor.js';
import { DashQLProcessorPlugin, DashQLUpdateEffect } from '../../workbook/editor/dashql_processor.js';
import { ScriptActionMenu } from '../../workbook/scripts/script_action_menu.js';
import { AnalyzerCard } from './analyzer_card.js';
import { AnalyzerEditor } from './analyzer_editor.js';
import { ScriptPhases, type ScriptPhasesProps } from './script_phases.js';
import * as styles from './analyzer_page.module.css';

import TPCH_SCHEMA from '../../../static/examples/tpch/schema.sql?raw';

const LOG_CTX = 'tools_analyzer';

/// The editor script when the page opens, the subquery of TPC-H query 2 as the formatter prints it in pretty mode
export const EDITOR_SCRIPT = `select min(ps_supplycost)
from partsupp, supplier, nation, region
where s_suppkey = ps_suppkey
    and s_nationkey = n_nationkey
    and n_regionkey = r_regionkey
    and r_name = 'EUROPE';`;

/// The scripts of the page: the catalog script defines the tables that the editor script reads
interface AnalyzerScripts {
    catalog: dashql.DashQLCatalog;
    catalogScript: dashql.DashQLScriptSession;
    editorScript: dashql.DashQLScriptSession;
}

/// What the phases know about the script of a session, and the summary of its card: its statements and errors
interface ScriptState {
    phases: ScriptPhasesProps;
    summary: string;
}

/// Read the phases of the script of a session after an analysis
function readScript(session: dashql.DashQLScriptSession, name: string, logger: Logger): ScriptState | null {
    try {
        const phases = { text: session.getText(), parsed: session.getParsed().unpack(), analyzed: session.getAnalyzed().unpack() };
        const statements = phases.parsed.statements.length;
        const errors = phases.parsed.scannerErrors.length + phases.parsed.parserErrors.length + phases.analyzed.errors.length;
        const summary = `${statements} ${statements === 1 ? 'statement' : 'statements'}` + (errors > 0 ? `, ${errors} ${errors === 1 ? 'error' : 'errors'}` : '');
        return { phases, summary };
    } catch (e) {
        logger.error(`Failed to read the ${name}`, { error: stringifyError(e) }, LOG_CTX);
        return null;
    }
}

/// The two scripts with their editors and phases
function AnalyzerScripts(props: { core: dashql.DashQL }) {
    const logger = useLogger();
    // The sessions are created while rendering, the effect below destroys them with the page
    const scripts = React.useMemo<AnalyzerScripts>(() => {
        const catalog = props.core.createCatalog();
        const catalogScript = props.core.createScriptSession(catalog);
        const editorScript = props.core.createScriptSession(catalog);
        catalogScript.replaceText(0n, TPCH_SCHEMA);
        editorScript.replaceText(0n, EDITOR_SCRIPT);
        // The catalog holds the tables before the first analysis of the editor script
        catalogScript.analyze();
        catalogScript.loadIntoCatalog();
        editorScript.analyze();
        return { catalog, catalogScript, editorScript };
    }, [props.core]);
    React.useEffect(() => () => {
        scripts.editorScript.destroy();
        scripts.catalogScript.destroy();
        scripts.catalog.destroy();
    }, [scripts]);

    // The catalog script is collapsed when the page opens, its summary shows that it holds the schema
    const [catalogExpanded, setCatalogExpanded] = React.useState(false);
    const [editorExpanded, setEditorExpanded] = React.useState(true);
    // Count the analyses of the scripts, the page reads a script once after each
    const [catalogRevision, bumpCatalog] = React.useReducer((revision: number) => revision + 1, 0);
    const [editorRevision, bumpEditor] = React.useReducer((revision: number) => revision + 1, 0);
    const catalogState = React.useMemo(
        () => readScript(scripts.catalogScript, 'catalog script', logger),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the session is mutable, the revision counts its analyses
        [scripts, logger, catalogRevision],
    );
    const editorState = React.useMemo(
        () => readScript(scripts.editorScript, 'editor script', logger),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the session is mutable, the revision counts its analyses
        [scripts, logger, editorRevision],
    );

    // The views of the editors while the cards are expanded, the action menus format through them
    const [catalogView, setCatalogView] = React.useState<EditorView | null>(null);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);

    // A new analysis of a changed catalog script replaces its tables in the catalog, and the page analyzes the editor
    // script again, an expanded editor shows that analysis. A load changes the catalog, which the catalog script
    // analyzes again with the next cursor move: that analysis of the same text loads nothing.
    const loadedText = React.useRef(scripts.catalogScript.getTextVersion());
    const onCatalogAnalysis = () => {
        bumpCatalog();
        const textVersion = scripts.catalogScript.getTextVersion();
        if (loadedText.current === textVersion) return;
        try {
            scripts.catalogScript.loadIntoCatalog();
            loadedText.current = textVersion;
            const update = scripts.editorScript.analyze();
            editorView?.dispatch({ effects: DashQLUpdateEffect.of({ ...editorView.state.field(DashQLProcessorPlugin), editorUpdate: update }) });
        } catch (e) {
            logger.error('Failed to load the catalog script into the catalog', { error: stringifyError(e) }, LOG_CTX);
        }
        bumpEditor();
    };

    // Pretty mode formats at the default width of the formatter: it breaks a clause only if it doesn't fit, a wide
    // editor would keep the clauses on one line. Compact mode fills the width of the editor. Both like the format
    // dialog of the shell. The editor applies the changes, so the cursor and the history stay, and the session
    // analyzes the new text.
    const actionMenu = (name: string, session: dashql.DashQLScriptSession, view: EditorView | null) => () => (
        <ScriptActionMenu
            scriptName={name}
            formatDisabled={view == null}
            onFormat={mode => formatScriptEditor(
                view,
                { scriptSession: session },
                mode,
                text => view?.dispatch({ changes: props.core.textChange(view.state.doc.toString(), text) }),
                false,
                undefined,
                undefined,
                mode === dashql.buffers.formatting.FormattingMode.PRETTY ? DEFAULT_FORMAT_WIDTH : undefined,
            )}
        />
    );

    return (
        <div className={styles.cards}>
            <AnalyzerCard
                title="Catalog Script"
                icon={DatabaseIcon}
                summary={catalogState?.summary ?? ''}
                expanded={catalogExpanded}
                onToggle={() => setCatalogExpanded(expanded => !expanded)}
                editor={() => <AnalyzerEditor session={scripts.catalogScript} onAnalysis={onCatalogAnalysis} onView={setCatalogView} />}
                actions={actionMenu('catalog', scripts.catalogScript, catalogView)}
            />
            <AnalyzerCard
                title="Editor Script"
                icon={CodeIcon}
                summary={editorState?.summary ?? ''}
                expanded={editorExpanded}
                onToggle={() => setEditorExpanded(expanded => !expanded)}
                editor={() => <AnalyzerEditor session={scripts.editorScript} onAnalysis={bumpEditor} onView={setEditorView} />}
                phases={() => editorState == null ? null : <ScriptPhases {...editorState.phases} />}
                actions={actionMenu('editor', scripts.editorScript, editorView)}
            />
        </div>
    );
}

/// The analyzer tool: a catalog script and an editor script that reads its tables, and what the scanner, the parser
/// and the analyzer of the core know about the editor script, see docs/design/tools.md
export function AnalyzerPage() {
    const core = useDashQLCore();
    return (
        <main className={styles.page}>
            <div className={styles.content}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Analyzer</h1>
                    <div className={styles.subtitle}>The tokens, the AST and the analysis of a script against a catalog</div>
                </header>
                {core == null ? <div className={styles.loading}>Loading DashQL…</div> : <AnalyzerScripts core={core} />}
            </div>
        </main>
    );
}
