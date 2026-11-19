import * as React from 'react';
import * as dashql from '@akohn/dashql';

import type { CellDetailProps } from '@akohn/dashql-react/components/data_table/data_table';
import {
    CellDetailOverlay as CellDetailOverlayView,
    type DetectSql,
    type SqlText,
} from '@akohn/dashql-react/components/query_result/cell_detail_overlay';
import { ReadonlySqlView, useProjectedSqlText } from '../../workbook/editor/readonly_sql_view.js';
import { useDashQLCoreSetup } from '../../host/core_provider.js';
import { useAppConfig } from '../../config/app_config.js';
import { getKeywordCase } from '../../workbook/scripts/script_format.js';
import { EngineProfileView } from '@akohn/dashql-react/components/query_profile/engine_profile_view';

// The detail of a cell in the app (CellDetailOverlay of @akohn/dashql-react): the core of the app reads a value as
// SQL, the editor of the app shows the texts, the core lays out plans

/// Read a cell value as SQL: scan and parse it, and format it in the Hyper dialect with the keyword case of the
/// settings. Null if the core cannot read it.
export function detectSqlText(
    core: dashql.DashQL,
    value: string,
    keywordCase = dashql.buffers.formatting.KeywordCase.LOWER,
): SqlText | null {
    let catalog: dashql.DashQLCatalog | null = null;
    let script: dashql.DashQLScript | null = null;
    let formattedScript: dashql.DashQLScript | null = null;
    try {
        catalog = core.createCatalog();
        script = core.createScript(catalog);
        script.insertTextAt(0, value);
        script.parse();
        const parsed = script.getParsed();
        const hasErrors = parsed != null && (parsed.read().scannerErrorsLength() > 0 || parsed.read().parserErrorsLength() > 0);
        let formattedText: string | null = null;
        try {
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.HYPER,
                dashql.buffers.formatting.FormattingMode.PRETTY,
                80,
                4,
                false,
                keywordCase,
            );
            formattedScript = script.format(config, null);
            formattedText = formattedScript.toString();
        } catch {
            // Format failed, but parse succeeded
        }
        return { hasErrors, formattedText };
    } catch {
        // Not valid SQL
        return null;
    } finally {
        formattedScript?.ptr.destroy();
        script?.ptr.destroy();
        catalog?.ptr.destroy();
    }
}

/// A SQL text highlighted by the core
function HighlightedSqlView(props: { text: string }) {
    const projected = useProjectedSqlText(props.text, 'cell_detail');
    return <ReadonlySqlView text={projected.text} editorUpdate={projected.editorUpdate} />;
}

/// The overlay is the detail of a cell of the data table
export type CellDetailOverlayProps = CellDetailProps;

/// The detail of a cell of a result table
export function CellDetailOverlay(props: CellDetailOverlayProps) {
    if (!props.isOpen) return null;
    return <OpenCellDetailOverlay {...props} />;
}

/// The overlay while it is open, it sets up the core
function OpenCellDetailOverlay(props: CellDetailOverlayProps) {
    const keywordCase = getKeywordCase(useAppConfig()?.settings);
    const coreSetup = useDashQLCoreSetup();
    const [core, setCore] = React.useState<dashql.DashQL | null>(null);
    React.useEffect(() => {
        let cancelled = false;
        coreSetup('cell_detail').then(c => {
            if (!cancelled) setCore(c);
        });
        return () => { cancelled = true; };
    }, [coreSetup]);
    const detectSql = React.useMemo<DetectSql | null>(
        () => core == null ? null : value => detectSqlText(core, value, keywordCase),
        [core, keywordCase],
    );
    return (
        <CellDetailOverlayView
            {...props}
            detectSql={detectSql}
            rawView={text => <ReadonlySqlView text={text} editorUpdate={null} lineWrapping autoHeight />}
            sqlView={text => <HighlightedSqlView text={text} />}
            planView={plan => <EngineProfileView {...plan} />}
        />
    );
}
