
import { VariantKind } from "@akohn/dashql/platform/utils/variant";

export const OAUTH_BROADCAST_CHANNEL = "dashql_oauth";

/// Envelope kind for app events sent via window.postMessage.
/// Required because a global window "message" listener otherwise receives
/// unrelated traffic (devtools bridges, extensions, etc.).
export const APP_EVENT_POST_MESSAGE_KIND = "dashql:app_event";

export interface AppEventPostMessage {
    kind: typeof APP_EVENT_POST_MESSAGE_KIND;
    data: string;
}

export function isAppEventPostMessage(msg: unknown): msg is AppEventPostMessage {
    if (msg == null || typeof msg !== "object") return false;
    const { kind, data } = msg as Partial<Record<keyof AppEventPostMessage, unknown>>;
    return kind === APP_EVENT_POST_MESSAGE_KIND && typeof data === "string";
}

export const SETUP_WORKBOOK = Symbol("SETUP_WORKBOOK");
export const SETUP_WORKBOOK_URL = Symbol("SETUP_WORKBOOK_URL");

export type SetupEventVariant =
    | VariantKind<typeof SETUP_WORKBOOK, Uint8Array>  // Workbook ZIP bytes
    | VariantKind<typeof SETUP_WORKBOOK_URL, string>  // Public dashql-workbook.json URL
    ;
