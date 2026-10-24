import * as React from 'react';
import { act } from '@dashql/browser-test-act';
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

type Field =
    | 'alias'
    | 'instance-url'
    | 'app-consumer-key'
    | 'login'
    | 'data-cloud-instance-url'
    | 'data-cloud-tenant-id'
    | 'core-tenant-id'
    | 'core-access-token'
    | 'data-cloud-access-token';

const DERIVED_FIELDS: Field[] = [
    'data-cloud-instance-url',
    'data-cloud-tenant-id',
    'core-tenant-id',
    'core-access-token',
    'data-cloud-access-token',
];

function input(field: Field): HTMLInputElement {
    const element = document.querySelector(`[data-testid="salesforce-${field}"]`);
    if (!(element instanceof HTMLInputElement)) throw new Error(`No ${field} input`);
    return element;
}

function isInvalid(field: Field): boolean {
    const element = input(field);
    if (element.getAttribute('aria-invalid') !== 'true') return false;
    // An invalid field references a non-empty validation message
    const messageId = element.getAttribute('aria-describedby');
    const message = messageId == null ? null : document.getElementById(messageId);
    return (message?.textContent?.trim() ?? '') !== '';
}

function closeButton(): HTMLButtonElement {
    const button = document.querySelector('[data-testid="connection-close"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('No close button');
    return button;
}

function byTestId<T extends Element = HTMLElement>(testId: string): T | null {
    return document.querySelector<T>(`[data-testid="${testId}"]`);
}

function historyToggle(): HTMLButtonElement {
    return byTestId<HTMLButtonElement>('salesforce-login-history-toggle')!;
}

function historyEntry(index: number): HTMLButtonElement {
    return document.querySelectorAll<HTMLButtonElement>('[data-testid="salesforce-login-history-entry"]')[index];
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
        const button = byTestId('connection-setup');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Connect button is not available');
        act(() => button.click());
    }

    function fillValidForm() {
        act(() => {
            setInputValue(input('alias'), ' production ');
            setInputValue(input('instance-url'), ' https://example.my.salesforce.com ');
            setInputValue(input('app-consumer-key'), ' consumer-key ');
        });
    }

    it('provides a labeled modal form with read-only derived fields and a close action', async () => {
        const result = open();
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBeTruthy();
        expect(closeButton()).toBeInstanceOf(HTMLButtonElement);
        expect(byTestId('connection-setup')).toBeInstanceOf(HTMLButtonElement);
        expect(input('alias').value).toBe('d360');
        expect(input('instance-url').disabled).toBe(false);
        expect(input('app-consumer-key').disabled).toBe(false);
        for (const field of DERIVED_FIELDS) {
            expect(input(field).disabled).toBe(true);
            expect(input(field).readOnly).toBe(true);
            expect(input(field).value).toBe('');
            expect(input(field).getAttribute('aria-label')).toBeTruthy();
        }
        expect(input('login').disabled).toBe(false);
        expect(input('login').readOnly).toBe(false);
        expect(historyToggle()).toBeInstanceOf(HTMLButtonElement);
        expect(document.activeElement).toBe(input('alias'));

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('uses an editable login hint until OAuth returns the token login', async () => {
        const result = open();
        openOAuthPopup.mockReturnValue(window);
        act(() => setInputValue(input('login'), 'hint@example.com'));
        fillValidForm();
        submit();

        await expect(result).resolves.toMatchObject({ loginHint: 'hint@example.com' });

        act(() => controller.update({ login: 'token@example.com' }));
        expect(input('login').value).toBe('token@example.com');
        expect(input('login').disabled).toBe(true);
    });

    it('shows Core credentials immediately and token-derived Data Cloud routing after exchange', async () => {
        const result = open();
        act(() => controller.update({
            status: 'Received Core access token',
            coreAccessToken: {
                createdAt: new Date(0).toISOString(),
                accessToken: 'opaque-core-token',
                instanceUrl: 'https://example.my.salesforce.com',
            },
        }));
        expect(input('core-access-token').value).toBe('opaque-core-token');
        expect(input('data-cloud-access-token').value).toBe('');
        expect(input('data-cloud-instance-url').value).toBe('');
        expect(input('data-cloud-tenant-id').value).toBe('');
        expect(input('core-tenant-id').value).toBe('');

        act(() => controller.update({
            status: 'Received Data Cloud access token',
            dataCloudAccessToken: {
                createdAt: new Date(0).toISOString(),
                expiresAt: new Date(1).toISOString(),
                instanceUrl: 'https://data.example.com',
                jwt: {
                    raw: 'data-cloud-jwt', header: {},
                    payload: { exp: 0.001, audienceTenantId: 'data-tenant' },
                },
            },
        }));
        expect(input('core-access-token').value).toBe('opaque-core-token');
        expect(input('data-cloud-access-token').value).toBe('data-cloud-jwt');
        expect(input('data-cloud-instance-url').value).toBe('https://data.example.com');
        expect(input('data-cloud-tenant-id').value).toBe('data-tenant');
        expect(input('core-tenant-id').value).toBe('data-tenant');
        expect(input('data-cloud-instance-url').disabled).toBe(true);
        expect(input('data-cloud-tenant-id').disabled).toBe(true);
        expect(input('data-cloud-instance-url').readOnly).toBe(true);
        expect(input('data-cloud-tenant-id').readOnly).toBe(true);
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
        const historyButton = historyToggle();

        await act(async () => {
            historyButton.click();
        });
        await vi.waitFor(() => expect(byTestId('salesforce-login-history-list')).not.toBeNull());

        expect(historyButton.getAttribute('aria-expanded')).toBe('true');
        expect(loadHistory).toHaveBeenCalledOnce();
        const savedLogin = historyEntry(0);
        expect(savedLogin.getAttribute('data-organization-id')).toBe('00D000000000001');
        expect(savedLogin.textContent).toContain('production');
        expect(savedLogin.textContent).toContain('https://production.my.salesforce.com');

        act(() => savedLogin.click());

        expect(input('alias').value).toBe('production');
        expect(input('instance-url').value).toBe('https://production.my.salesforce.com');
        expect(input('app-consumer-key').value).toBe('saved-consumer-key');
        expect(input('data-cloud-instance-url').value).toBe('');
        expect(input('data-cloud-tenant-id').value).toBe('');
        expect(input('login').value).toBe('user@example.com');
        expect(historyButton.getAttribute('aria-expanded')).toBe('false');

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('allows a saved login to connect without manual Data Cloud routing', async () => {
        loadHistory.mockResolvedValue([{
            organizationId: '00D000000000001',
            name: 'legacy',
            instanceUrl: 'https://legacy.my.salesforce.com',
            appConsumerKey: 'saved-consumer-key',
            lastUsedAt: '2026-08-19T10:00:00.000Z',
        }]);
        const result = open();
        openOAuthPopup.mockReturnValue(window);
        fillValidForm();
        await act(async () => {
            historyToggle().click();
        });
        await vi.waitFor(() => expect(byTestId('salesforce-login-history-list')).not.toBeNull());
        act(() => historyEntry(0).click());

        expect(input('data-cloud-instance-url').value).toBe('');
        expect(input('data-cloud-tenant-id').value).toBe('');
        submit();
        expect(openOAuthPopup).toHaveBeenCalledOnce();
        await expect(result).resolves.toMatchObject({
            alias: 'legacy', instanceUrl: 'https://legacy.my.salesforce.com', appConsumerKey: 'saved-consumer-key',
        });

        act(() => closeButton().click());
    });

    it('shows an empty history state and closes the history before the login dialog on Escape', async () => {
        const result = open();
        const historyButton = historyToggle();
        await act(async () => historyButton.click());

        expect(byTestId('salesforce-login-history-empty')).not.toBeNull();
        expect(document.activeElement).toBe(byTestId('salesforce-login-history'));
        act(() => byTestId('salesforce-login-dialog')!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ));

        expect(historyToggle().getAttribute('aria-expanded')).toBe('false');
        expect(byTestId('salesforce-login-history')).toBeNull();
        expect(byTestId('salesforce-login-dialog')).not.toBeNull();

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
        const historyButton = historyToggle();
        await act(async () => {
            historyButton.click();
        });
        await vi.waitFor(() => expect(byTestId('salesforce-login-history-delete')).not.toBeNull());

        const deleteButton = byTestId<HTMLButtonElement>('salesforce-login-history-delete')!;
        expect(deleteButton.getAttribute('data-organization-id')).toBe('00D000000000001');
        await act(async () => deleteButton.click());
        await vi.waitFor(() => expect(byTestId('salesforce-login-history-list')).toBeNull());

        expect(deleteHistoryEntry).toHaveBeenCalledWith('00D000000000001');
        expect(byTestId('salesforce-login-history-empty')).not.toBeNull();
        expect(historyButton.getAttribute('aria-expanded')).toBe('true');

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('trims fields and reports inline validation errors', async () => {
        const result = open();
        act(() => {
            setInputValue(input('alias'), '   ');
            setInputValue(input('instance-url'), ' ftp://example.com ');
            setInputValue(input('app-consumer-key'), '   ');
        });
        submit();

        expect(isInvalid('alias')).toBe(true);
        expect(isInvalid('instance-url')).toBe(false);
        expect(isInvalid('app-consumer-key')).toBe(true);
        expect(openOAuthPopup).not.toHaveBeenCalled();

        act(() => {
            setInputValue(input('alias'), 'invalid-alias');
            setInputValue(input('instance-url'), 'https://login.salesforce.com');
            setInputValue(input('app-consumer-key'), 'key');
        });
        submit();
        expect(isInvalid('alias')).toBe(true);
        expect(isInvalid('instance-url')).toBe(false);
        expect(isInvalid('app-consumer-key')).toBe(false);
        expect(openOAuthPopup).not.toHaveBeenCalled();

        act(() => closeButton().click());
        await expect(result).resolves.toBeNull();
    });

    it('starts OAuth with blank read-only Data Cloud routing fields', async () => {
        const result = open();
        openOAuthPopup.mockReturnValue(window);
        fillValidForm();
        expect(input('data-cloud-instance-url').value).toBe('');
        expect(input('data-cloud-tenant-id').value).toBe('');
        submit();

        expect(openOAuthPopup).toHaveBeenCalledOnce();
        const values = await result;
        expect(values).not.toHaveProperty('dataCloudInstanceUrl');
        expect(values).not.toHaveProperty('dataCloudTenantId');

        act(() => closeButton().click());
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
        expect(byTestId('connection-cancel')).not.toBeNull();
        expect(byTestId('connection-setup')).toBeNull();
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

        act(() => controller.succeed('Authenticated with Salesforce as production'));

        expect(document.querySelector('[role="dialog"]')).toBeNull();
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
        expect(isInvalid('app-consumer-key')).toBe(true);
        expect(byTestId('connection-setup')).not.toBeNull();

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
        expect(byTestId('connection-status')?.textContent).toContain('authorization failed');
        expect(input('alias').value).toBe('production');
        expect(input('instance-url').value).toBe('https://example.my.salesforce.com');
        expect(input('app-consumer-key').value).toBe('consumer-key');
        expect(input('data-cloud-instance-url').value).toBe('');
        expect(input('data-cloud-tenant-id').value).toBe('');

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
