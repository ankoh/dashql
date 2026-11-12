import { describe, expect, it } from 'vitest';

import { IndicatorStatus } from '../ui/foundations/status_indicator.js';
import {
    cloudLoadingDetail,
    cloudLoadingDownloaded,
    cloudLoadingFailed,
    cloudLoadingStep,
    startCloudLoading,
    type CloudWorkbookLoading,
} from './cloud_workbook_loading.js';

function statuses(state: CloudWorkbookLoading): Record<string, string> {
    return Object.fromEntries(state.steps.map(step => [step.id, `${IndicatorStatus[step.status]}${step.detail == null ? '' : ` ${step.detail}`}`]));
}

describe('Loading a published workbook', () => {
    it('skips the steps that a version has nothing for and follows the import', () => {
        let state = startCloudLoading('Stocks', true);
        expect(statuses(state)).toEqual({
            download: 'Running', connections: 'None', results: 'None', scripts: 'None', attachments: 'None', open: 'None',
        });
        state = cloudLoadingDownloaded(state, { version: 3, connections: 2, results: 0, scripts: 4, attachments: 0 });
        expect(statuses(state)).toEqual({
            download: 'Succeeded Version 3', connections: 'None 2 connections', results: 'Skip None', scripts: 'None 4 scripts',
            attachments: 'Skip None', open: 'None',
        });
        state = cloudLoadingStep(state, 'connections');
        state = cloudLoadingDetail(state, 'connections', '2 connections, 1 new');
        // The import reports no results without any, a skipped step stays skipped
        state = cloudLoadingStep(state, 'scripts');
        state = cloudLoadingStep(state, 'attachments');
        expect(statuses(state)).toMatchObject({
            connections: 'Succeeded 2 connections, 1 new', results: 'Skip None', scripts: 'Running 4 scripts', attachments: 'Skip None',
        });
        state = cloudLoadingStep(state, 'open');
        expect(statuses(state)).toMatchObject({ scripts: 'Succeeded 4 scripts', open: 'Running' });
    });

    it('marks the step that failed', () => {
        let state = cloudLoadingDownloaded(startCloudLoading('Stocks', false), { version: 1, connections: 1, results: 2, scripts: 1, attachments: 1 });
        state = cloudLoadingStep(state, 'results');
        state = cloudLoadingFailed(state, 'disk full');
        expect(state.error).toBe('disk full');
        expect(statuses(state)).toMatchObject({ results: 'Failed 2 results', scripts: 'None 1 script' });
    });
});
