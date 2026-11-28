/// Let the keyboard of a touch screen resize the content of the page, so the keys of SQL sit right above it
/// (docs/design/narrow_layouts.md). `interactive-widget` of the viewport meta is known to Chromium and Firefox; WebKit
/// logs an error for a key that it doesn't know, the app adds it in the other engines only.
export function resizeContentForKeyboard(doc: Document, nav: Navigator): void {
    // `userAgentData` is an API of Chromium only
    const chromium = 'userAgentData' in nav;
    const firefox = nav.userAgent.includes('Firefox/');
    if (!chromium && !firefox) return;
    const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta == null || meta.content.includes('interactive-widget')) return;
    meta.content = `${meta.content}, interactive-widget=resizes-content`;
}
