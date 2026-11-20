import * as React from 'react';
import * as dashql from '@akohn/dashql';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { AppSettings } from '../../config/app_settings.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

export const DEFAULT_FORMAT_WIDTH = 80;
const DEFAULT_FORMAT_INDENTATION = 4;
export const MIN_FORMAT_WIDTH = 24;

export function formattingDialectForConnector(connectorType?: ConnectorType): dashql.buffers.formatting.FormattingDialect {
    return connectorType === ConnectorType.TRINO
        ? dashql.buffers.formatting.FormattingDialect.TRINO
        : dashql.buffers.formatting.FormattingDialect.HYPER;
}

export function getKeywordCase(settings?: AppSettings): dashql.buffers.formatting.KeywordCase {
    return settings?.keywordCase === 'upper'
        ? dashql.buffers.formatting.KeywordCase.UPPER
        : dashql.buffers.formatting.KeywordCase.LOWER;
}

export function createScriptFormatConfig(
    mode: dashql.buffers.formatting.FormattingMode,
    debugMode: boolean = false,
    maxWidth: number = DEFAULT_FORMAT_WIDTH,
    keywordCase: dashql.buffers.formatting.KeywordCase = dashql.buffers.formatting.KeywordCase.LOWER,
    dialect: dashql.buffers.formatting.FormattingDialect = dashql.buffers.formatting.FormattingDialect.HYPER,
): dashql.buffers.formatting.FormattingConfigT {
    return new dashql.buffers.formatting.FormattingConfigT(
        dialect,
        mode,
        maxWidth,
        DEFAULT_FORMAT_INDENTATION,
        debugMode,
        keywordCase,
    );
}

/// Format a SQL text in a throwaway script, null if the formatter cannot format all of it
export function formatSqlText(core: dashql.DashQL, text: string, config: dashql.buffers.formatting.FormattingConfigT): string | null {
    const catalog = core.createCatalog();
    const script = core.createScript(catalog);
    let formatted: dashql.DashQLScript | null = null;
    try {
        script.insertTextAt(0, text);
        if (!script.isFullyFormattable(config)) return null;
        formatted = script.format(config);
        return formatted.toString();
    } catch {
        return null;
    } finally {
        formatted?.destroy();
        script.destroy();
        catalog.destroy();
    }
}

/// The text of a script at a version of its text. The object stays the same while the text does, a cursor move keeps
/// it, so a function of the text is memoized on it.
export interface ScriptText {
    scriptSession: ScriptData['scriptSession'];
    textVersion: bigint | null;
}

/// The text of a script, null without one
export function useScriptText(scriptData: ScriptData | null): ScriptText | null {
    const scriptSession = scriptData?.scriptSession ?? null;
    const textVersion = scriptData?.editorUpdate?.textVersion ?? null;
    return React.useMemo(
        () => scriptSession == null ? null : { scriptSession, textVersion },
        [scriptSession, textVersion],
    );
}

export function isScriptFormattable(
    scriptData: Pick<ScriptData, 'scriptSession'> | null,
    dialect: dashql.buffers.formatting.FormattingDialect = dashql.buffers.formatting.FormattingDialect.HYPER,
): boolean {
    if (scriptData == null) return false;
    try {
        return scriptData.scriptSession.isFullyFormattable(
            createScriptFormatConfig(dashql.buffers.formatting.FormattingMode.PRETTY, false, DEFAULT_FORMAT_WIDTH,
                dashql.buffers.formatting.KeywordCase.LOWER, dialect),
            true,
        );
    } catch {
        return false;
    }
}
