import * as React from 'react';
import * as dashql from '@akohn/dashql';

import type { EditorView } from '@codemirror/view';

import { CodeIcon, DatabaseIcon } from '@akohn/dashql-react/components/symbol_icon';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useDashQLCore } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { createScriptFormatConfig, DEFAULT_FORMAT_WIDTH } from '../../workbook/scripts/script_format.js';
import { measureScriptFormatWidth } from '../../workbook/editor/script_format_editor.js';
import { FormatMenu } from './format_menu.js';
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

/// What the phases know about the script of a session, read after an analysis
function readPhases(session: dashql.DashQLScriptSession): ScriptPhasesProps {
    return {
        text: session.getText(),
        parsed: session.getParsed().unpack(),
        analyzed: session.getAnalyzed().unpack(),
    };
}

/// The summary of a script in the header of its card: its statements and errors
function summarize(session: dashql.DashQLScriptSession): string {
    const parsed = session.getParsed().read();
    const statements = parsed.statementsLength();
    const errors = parsed.scannerErrorsLength() + parsed.parserErrorsLength() + session.getAnalyzed().read().errorsLength();
    return `${statements} ${statements === 1 ? 'statement' : 'statements'}` + (errors > 0 ? `, ${errors} ${errors === 1 ? 'error' : 'errors'}` : '');
}

const renderPhases = (phases: ScriptPhasesProps | null) => () => phases == null ? null : <ScriptPhases {...phases} />;

/// Format the script of a session. Pretty mode formats at the default width of the formatter: it breaks a clause only
/// if it doesn't fit, a wide editor would keep the clauses on one line. Compact mode fills the width of the editor.
/// Both like the format dialog of the shell. The editor applies the changes, so the cursor and the history stay, and
/// the session analyzes the new text. Throws if the formatter can't format the script.
function formatScript(core: dashql.DashQL, session: dashql.DashQLScriptSession, view: EditorView, mode: dashql.buffers.formatting.FormattingMode): void {
    const width = mode === dashql.buffers.formatting.FormattingMode.COMPACT ? measureScriptFormatWidth(view) : DEFAULT_FORMAT_WIDTH;
    const formatted = session.format(createScriptFormatConfig(mode, false, width));
    try {
        const from = view.state.doc.toString();
        const to = formatted.toString();
        if (from !== to) view.dispatch({ changes: core.textChange(from, to) });
    } finally {
        formatted.destroy();
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
    // The catalog script shows only its summary, the editor script its phases
    const [catalogSummary, setCatalogSummary] = React.useState('');
    const [editorSummary, setEditorSummary] = React.useState('');
    const [editorPhases, setEditorPhases] = React.useState<ScriptPhasesProps | null>(null);
    // Counts the loads of the catalog script into the catalog, the editor script is analyzed again after each
    const [catalogRevision, setCatalogRevision] = React.useState(0);

    const readCatalog = React.useCallback(() => {
        try {
            setCatalogSummary(summarize(scripts.catalogScript));
        } catch (e) {
            logger.error('Failed to read the catalog script', { error: stringifyError(e) }, LOG_CTX);
        }
    }, [scripts, logger]);
    const readEditor = React.useCallback(() => {
        try {
            setEditorSummary(summarize(scripts.editorScript));
            setEditorPhases(readPhases(scripts.editorScript));
        } catch (e) {
            logger.error('Failed to read the phases of the editor script', { error: stringifyError(e) }, LOG_CTX);
        }
    }, [scripts, logger]);

    // A new analysis of a changed catalog script replaces its tables in the catalog. A load changes the catalog, which
    // the catalog script analyzes again with the next cursor move: that analysis of the same text loads nothing.
    const loadedText = React.useRef(scripts.catalogScript.getTextVersion());
    const onCatalogAnalysis = React.useCallback(() => {
        readCatalog();
        const textVersion = scripts.catalogScript.getTextVersion();
        if (loadedText.current === textVersion) return;
        try {
            scripts.catalogScript.loadIntoCatalog();
            loadedText.current = textVersion;
        } catch (e) {
            logger.error('Failed to load the catalog script into the catalog', { error: stringifyError(e) }, LOG_CTX);
        }
        setCatalogRevision(revision => revision + 1);
    }, [scripts, readCatalog, logger]);
    const onEditorAnalysis = readEditor;

    // The views of the editors while the cards are expanded, the format buttons go through them
    const [catalogView, setCatalogView] = React.useState<EditorView | null>(null);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const formatMenu = (name: string, session: dashql.DashQLScriptSession, view: EditorView | null) => () => (
        <FormatMenu
            scriptName={name}
            disabled={view == null}
            onFormat={mode => {
                if (view == null) return;
                try {
                    formatScript(props.core, session, view, mode);
                } catch (e) {
                    logger.warn('The script cannot be formatted', { error: stringifyError(e) }, LOG_CTX);
                }
                view.focus();
            }}
        />
    );

    // The phases of the scripts when the page opens, the editors report every analysis after
    React.useLayoutEffect(() => {
        readCatalog();
        readEditor();
    }, [readCatalog, readEditor]);
    // After the catalog changed, the editor of the editor script analyzes it again. A collapsed card has no editor, the
    // page analyzes the script itself.
    React.useEffect(() => {
        if (editorExpanded || catalogRevision === 0) return;
        scripts.editorScript.analyze();
        onEditorAnalysis();
    }, [scripts, editorExpanded, catalogRevision, onEditorAnalysis]);

    return (
        <div className={styles.cards}>
            <AnalyzerCard
                title="Catalog Script"
                icon={DatabaseIcon}
                summary={catalogSummary}
                expanded={catalogExpanded}
                onToggle={() => setCatalogExpanded(expanded => !expanded)}
                editor={() => <AnalyzerEditor session={scripts.catalogScript} catalogRevision={0} onAnalysis={onCatalogAnalysis} onView={setCatalogView} />}
                actions={formatMenu('catalog script', scripts.catalogScript, catalogView)}
            />
            <AnalyzerCard
                title="Editor Script"
                icon={CodeIcon}
                summary={editorSummary}
                expanded={editorExpanded}
                onToggle={() => setEditorExpanded(expanded => !expanded)}
                editor={() => <AnalyzerEditor session={scripts.editorScript} catalogRevision={catalogRevision} onAnalysis={onEditorAnalysis} onView={setEditorView} />}
                phases={renderPhases(editorPhases)}
                actions={formatMenu('editor script', scripts.editorScript, editorView)}
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
