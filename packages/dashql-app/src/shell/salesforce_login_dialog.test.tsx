import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import {
    type SalesforceLoginDialogController,
    type SalesforceLoginDialogOptions,
    useSalesforceLoginDialog,
} from './salesforce_login_dialog.js';
import type { SalesforceLoginHistoryEntry } from './salesforce_login_history.js';

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function inputForLabel(labelText: string): HTMLInputElement {
    const field = Array.from(document.querySelectorAll('div'))
        .find(candidate => candidate.textContent?.trim() === labelText)
        ?.parentElement;
    const input = field?.querySelector('input') ?? null;
    if (!(input instanceof HTMLInputElement)) throw new Error(`No input labeled "${labelText}"`);
    return input;
}

function closeButton(): HTMLButtonElement {
    const button = Array.from(document.querySelectorAll('button')).find(candidate =>
        candidate.textContent === 'Close'
        || candidate.getAttribute('aria-label') === 'Close'
        || candidate.getAttribute('aria-labelledby'),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('No close button');
    return button;
}

describe('useSalesforceLoginDialog', () => {
    let container: HTMLDivElement;
    let root: Root;
    let mounted: boolean;
    let controller: SalesforceLoginDialogController;
    let openOAuthPopup: ReturnType<typeof vi.fn<() => Window | null>>;
    let loadHistory: ReturnType<typeof vi.fn<() => Promise<SalesforceLoginHistoryEntry[]>>>;
    let deleteHistoryEntry: ReturnType<typeof vi.fn<(organizationId: string) => Promise<SalesforceLoginHistoryEntry[]>>>;

    const Harness = (props: SalesforceLoginDialogOptions) => {
        const loginDialog = useSalesforceLoginDialog(props);
        controller = loginDialog.controller;
        return (
            <div>
                <button type="button">Open login</button>
                {loginDialog.dialog}
            </div>
        );
    };

    beforeEach(() => {
        HTMLElement.prototype.showPopover ??= vi.fn();
        HTMLElement.prototype.hidePopover ??= vi.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mounted = true;
        openOAuthPopup = vi.fn();
        loadHistory = vi.fn().mockResolvedValue([]);
        deleteHistoryEntry = vi.fn().mockResolvedValue([]);
        act(() => root.render(
            <Harness
                openOAuthPopup={openOAuthPopup}
                loadHistory={loadHistory}
                deleteHistoryEntry={deleteHistoryEntry}
            />,
        ));
    });

    afterEach(() => {
        if (mounted) act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    function open(signal?: AbortSignal) {
        let result!: Promise<Awaited<ReturnType<SalesforceLoginDialogController['request']>>>;
        act(() => {
            result = controller.request(signal);
        });
        return result;
    }

    function submit() {
        const button = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent === 'Connect');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Connect button is not available');
        act(() => button.click());
    }

    function fillValidForm() {
        act(() => {
            setInputValue(inputForLabel('Connection Alias'), ' production ');
            setInputValue(inputForLabel('Salesforce Instance URL'), ' https://example.my.salesforce.com ');
            setInputValue(inputForLabel('Connected App'), ' consumer-key ');
        });
    }

    it('provides a named form with explicit field labels and a close action', async () => {
        const result = open();
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBe('Salesforce Data Cloud connection');
        expect(closeButton()).toBeInstanceOf(HTMLButtonElement);
        expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Connect')).toBe(true);
        expect(inputForLabel('Connection Alias').value).toBe('d360');
        expect(inputForLabel('Salesforce Instance URL')).toBeInstanceOf(HTMLInputElement);
        expect(inputForLabel('Connected App')).toBeInstanceOf(HTMLInputElement);
        expect(inputForLabel('Login').disabled).toBe(true);
        expect(document.querySelector('button[aria-label="Recent Salesforce logins"]')).toBeInstanceOf(HTMLButtonElement);
        expect(document.activeElement).toBe(inputForLabel('Connection Alias'));

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('loads saved logins and prefills the selected connection', async () => {
        loadHistory.mockResolvedValue([{
            organizationId: '00D000000000001',
            name: 'production',
            instanceUrl: 'https://production.my.salesforce.com',
            appConsumerKey: 'saved-consumer-key',
            loginHint: 'user@example.com',
            lastUsedAt: '2026-08-19T10:00:00.000Z',
        }]);
        const result = open();
        const historyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Recent Salesforce logins"]')!;

        await act(async () => {
            historyButton.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(historyButton.getAttribute('aria-expanded')).toBe('true');
        expect(loadHistory).toHaveBeenCalledOnce();
        expect(document.querySelector('ul[aria-label="Recent Salesforce logins"]')?.textContent).toContain('production');
        expect(document.querySelector('ul[aria-label="Recent Salesforce logins"]')?.textContent).toContain(
            'https://production.my.salesforce.com',
        );

        const savedLogin = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent?.includes('production.my.salesforce.com'))!;
        act(() => savedLogin.click());

        expect(inputForLabel('Connection Alias').value).toBe('production');
        expect(inputForLabel('Salesforce Instance URL').value).toBe('https://production.my.salesforce.com');
        expect(inputForLabel('Connected App').value).toBe('saved-consumer-key');
        expect(inputForLabel('Login').value).toBe('user@example.com');
        expect(historyButton.getAttribute('aria-expanded')).toBe('false');

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('shows an empty history state and closes the history before the login dialog on Escape', async () => {
        const result = open();
        const historyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Recent Salesforce logins"]')!;
        await act(async () => historyButton.click());

        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Successful logins will appear here.');
        expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('salesforce-login-history-title');
        act(() => document.querySelectorAll('[role="dialog"]')[0].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ));

        expect(document.querySelector('button[aria-label="Recent Salesforce logins"]')?.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector('[aria-label="Salesforce Data Cloud connection"]')).not.toBeNull();

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('deletes a saved login without closing the history', async () => {
        loadHistory.mockResolvedValue([{
            organizationId: '00D000000000001',
            name: 'production',
            instanceUrl: 'https://production.my.salesforce.com',
            appConsumerKey: 'saved-consumer-key',
            lastUsedAt: '2026-08-19T10:00:00.000Z',
        }]);
        const result = open();
        const historyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Recent Salesforce logins"]')!;
        await act(async () => {
            historyButton.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        const deleteButton = document.querySelector<HTMLButtonElement>(
            'button[aria-label="Delete production from recent logins"]',
        )!;
        await act(async () => deleteButton.click());

        expect(deleteHistoryEntry).toHaveBeenCalledWith('00D000000000001');
        expect(document.querySelector('ul[aria-label="Recent Salesforce logins"]')).toBeNull();
        expect(document.querySelector('[aria-labelledby="salesforce-login-history-title"]')?.textContent)
            .toContain('Successful logins will appear here.');
        expect(historyButton.getAttribute('aria-expanded')).toBe('true');

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('trims fields, reports inline validation errors, and focuses the first invalid field', async () => {
        const result = open();
        act(() => {
            setInputValue(inputForLabel('Connection Alias'), '   ');
            setInputValue(inputForLabel('Salesforce Instance URL'), ' ftp://example.com ');
            setInputValue(inputForLabel('Connected App'), '   ');
        });
        submit();

        const alias = inputForLabel('Connection Alias');
        const instanceUrl = inputForLabel('Salesforce Instance URL');
        const appConsumerKey = inputForLabel('Connected App');
        expect(alias.parentElement?.parentElement?.textContent).toContain('Alias cannot be empty');
        expect(instanceUrl.parentElement?.parentElement?.textContent).not.toContain('cannot be empty');
        expect(appConsumerKey.parentElement?.parentElement?.textContent).toContain('Connected App cannot be empty');
        expect(openOAuthPopup).not.toHaveBeenCalled();

        act(() => {
            setInputValue(alias, 'invalid-alias');
            setInputValue(instanceUrl, 'https://login.salesforce.com');
            setInputValue(appConsumerKey, 'key');
        });
        submit();
        expect(alias.parentElement?.parentElement?.textContent).toContain('underscores');

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('opens the OAuth popup synchronously and resolves trimmed values on submit', async () => {
        const oauthPopup = {} as Window;
        openOAuthPopup.mockReturnValue(oauthPopup);
        const result = open();
        fillValidForm();

        submit();

        expect(openOAuthPopup).toHaveBeenCalledOnce();
        await expect(result).resolves.toEqual({
            alias: 'production',
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            loginHint: '',
            oauthPopup,
            abortSignal: expect.any(AbortSignal),
        });
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Starting authorization');
        act(() => closeButton().click());
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('submits without opening a popup for native OAuth', async () => {
        act(() => root.render(<Harness nativeOAuth openOAuthPopup={openOAuthPopup} />));
        const result = open();
        fillValidForm();

        submit();

        expect(openOAuthPopup).not.toHaveBeenCalled();
        await expect(result).resolves.toEqual(expect.objectContaining({
            alias: 'production',
            oauthPopup: undefined,
        }));
        act(() => closeButton().click());
    });

    it('closes automatically when login succeeds', async () => {
        openOAuthPopup.mockReturnValue({} as Window);
        const result = open();
        fillValidForm();
        submit();
        await expect(result).resolves.toEqual(expect.objectContaining({ alias: 'production' }));

        act(() => controller.succeed('Attached production'));

        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('rejects duplicate aliases inline before opening OAuth', async () => {
        act(() => root.render(<Harness openOAuthPopup={openOAuthPopup} hasAlias={(alias: string) => alias.toLowerCase() === 'production'} />));
        const result = open();
        fillValidForm();
        submit();

        expect(openOAuthPopup).not.toHaveBeenCalled();
        expect(inputForLabel('Connection Alias').parentElement?.parentElement?.textContent).toContain(
            'Salesforce alias already exists: production',
        );

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('settles with null when cancelled', async () => {
        const result = open();
        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('settles with null on Escape', async () => {
        const result = open();
        act(() => document.querySelector('[role="dialog"]')!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ));
        await expect(result).resolves.toBeNull();
    });

    it('settles with null on an outside click', async () => {
        const result = open();
        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
        await expect(result).resolves.toBeNull();
    });

    it('settles with null when aborted or unmounted', async () => {
        const abortController = new AbortController();
        const aborted = open(abortController.signal);
        act(() => abortController.abort());
        await expect(aborted).resolves.toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBeNull();

        const unmounted = open();
        act(() => root.unmount());
        mounted = false;
        await expect(unmounted).resolves.toBeNull();
    });

    it('keeps the dialog open and announces a blocked OAuth popup', async () => {
        openOAuthPopup.mockReturnValue(null);
        const result = open();
        fillValidForm();
        submit();

        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('OAuth window was blocked');

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('reuses the current settings when connecting again after a failure', async () => {
        const firstPopup = {} as Window;
        const secondPopup = {} as Window;
        openOAuthPopup.mockReturnValueOnce(firstPopup).mockReturnValueOnce(secondPopup);
        const first = open();
        fillValidForm();
        submit();
        await expect(first).resolves.toEqual(expect.objectContaining({ oauthPopup: firstPopup }));

        act(() => controller.fail('authorization failed'));
        const retry = open();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('authorization failed');
        expect(inputForLabel('Connection Alias').value).toBe('production');
        expect(inputForLabel('Salesforce Instance URL').value).toBe('https://example.my.salesforce.com');
        expect(inputForLabel('Connected App').value).toBe('consumer-key');

        submit();
        await expect(retry).resolves.toEqual(expect.objectContaining({
            alias: 'production',
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            oauthPopup: secondPopup,
        }));
        expect(openOAuthPopup).toHaveBeenCalledTimes(2);

        act(() => closeButton().click());
    });

    it('rejects concurrent requests without disturbing the pending request', async () => {
        const first = open();
        const second = controller.request();

        await expect(second).rejects.toThrow('already pending');
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        act(() => closeButton().click());
        await expect(first).resolves.toBeNull();
    });
});
