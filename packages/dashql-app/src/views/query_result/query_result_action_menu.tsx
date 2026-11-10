import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from '../../app/action_menu.module.css';

import { QueryExecutionStatus, type QueryExecutionState } from '../../query/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import * as ActionList from '../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { useAppConfig } from '../../config/app_config.js';
import { SET_SCRIPT_TEXT, scriptResultOwner, type ScriptData, type WorkbookScripts } from '../../workbook/scripts/workbook_scripts.js';
import { useWorkbookScriptsDispatch, useWorkbookScriptsRegistryReader } from '../../workbook/scripts/workbook_scripts_registry.js';
import { createScriptFormatConfig, formattingDialectForConnector, getKeywordCase } from '../../workbook/scripts/script_format.js';
import { addResultProjection, ResultProjectionError } from './result_projection.js';

const MoreIcon = SymbolIcon('kebab_horizontal');
const ProjectionIcon = SymbolIcon('columns_16');

const PROJECTION_ERRORS: Record<ResultProjectionError, string> = {
    [ResultProjectionError.NotParsed]: 'The script does not parse',
    [ResultProjectionError.NoQuery]: 'The last statement is no query',
    [ResultProjectionError.NoColumns]: 'The result has no columns',
    [ResultProjectionError.DuplicateColumns]: 'Two columns have the same name',
};

function isProjectionError(text: string | ResultProjectionError): text is ResultProjectionError {
    return Object.prototype.hasOwnProperty.call(PROJECTION_ERRORS, text);
}

/// The script of a workbook that owns a query result
function findResultScript(workbookScripts: WorkbookScripts, owner: string): ScriptData | null {
    for (const script of Object.values(workbookScripts.scripts)) {
        if (scriptResultOwner(workbookScripts.workbookId, script.scriptKey) === owner) return script;
    }
    return null;
}

interface Props {
    query: QueryExecutionState;
}

/// The actions of a query result that rewrite the script of the result. Results without a script, e.g. of the
/// shell or the catalog, have no menu. The standalone shell also has no storage or scripts, so the hooks that need
/// them must not run for its results.
export function QueryResultActionMenu({ query }: Props): React.ReactElement | null {
    const workbookId = query.queryMetadata.workbookId;
    const owner = query.queryMetadata.resultOwner;
    if (workbookId == null || owner == null) return null;
    return <ScriptResultActionMenu query={query} workbookId={workbookId} owner={owner} />;
}

interface ScriptResultProps extends Props {
    workbookId: string;
    owner: string;
}

function ScriptResultActionMenu({ query, workbookId, owner }: ScriptResultProps): React.ReactElement {
    const readRegistry = useWorkbookScriptsRegistryReader();
    const dispatchWorkbookScripts = useWorkbookScriptsDispatch();
    const config = useAppConfig();
    const [open, setOpen] = React.useState(false);
    // The rewrite is computed when the menu opens, the item says why a script cannot get it
    const [projection, setProjection] = React.useState<{ scriptKey: number; text: string } | ResultProjectionError | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);

    const hasResult = query.status === QueryExecutionStatus.SUCCEEDED && query.resultTable != null;

    const openMenu = () => {
        setProjection(null);
        setOpen(true);
        const workbookScripts = readRegistry().workbookScriptsMap.get(workbookId);
        const script = workbookScripts == null ? null : findResultScript(workbookScripts, owner);
        if (workbookScripts == null || script == null || query.resultTable == null) return;
        const formatConfig = createScriptFormatConfig(
            dashql.buffers.formatting.FormattingMode.PRETTY,
            false,
            undefined,
            getKeywordCase(config?.settings),
            formattingDialectForConnector(script.connection.connectorInfo.connectorType),
        );
        const columnNames = query.resultTable.schema.fields.map(field => field.name);
        const text = addResultProjection(workbookScripts.instance, script.scriptSession.getText(), columnNames, formatConfig);
        // The errors are strings as well
        setProjection(isProjectionError(text) ? text : { scriptKey: script.scriptKey, text });
    };
    const applyProjection = () => {
        setOpen(false);
        if (projection == null || typeof projection !== 'object') return;
        // Staged as a diff like the formatting, the user accepts or rejects it in the editor
        void dispatchWorkbookScripts(workbookId, {
            type: SET_SCRIPT_TEXT,
            value: { scriptKey: projection.scriptKey, text: projection.text, withDiff: true },
        });
    };
    const projectionError = projection != null && typeof projection !== 'object' ? PROJECTION_ERRORS[projection] : null;

    return (
        <AnchoredOverlay
            open={open}
            onOpen={openMenu}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label="More actions for the query result"
                    data-testid="query-result-more-actions"
                    disabled={!hasResult}
                >
                    <MoreIcon size={16} />
                </IconButton>
            )}
        >
            <div className={styles.menu} role="dialog" aria-label="Query result actions">
                <ActionList.List aria-label="Query result actions">
                    <ActionList.ListItem
                        data-testid="query-result-project-columns"
                        disabled={projection == null || typeof projection !== 'object'}
                        onClick={applyProjection}
                    >
                        <ActionList.Leading><ProjectionIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>
                            <ActionList.ItemTextTitle>Project Columns</ActionList.ItemTextTitle>
                            {projectionError != null ? <ActionList.ItemTextDescription>{projectionError}</ActionList.ItemTextDescription> : undefined}
                        </ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
}
