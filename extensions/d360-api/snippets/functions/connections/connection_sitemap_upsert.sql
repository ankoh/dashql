/**
 * Upload the Web SDK sitemap of a Streaming App connection, the JavaScript that holds the data capture rules of the website.
 *
 * Write the script as a `$$...$$` string. Read the sitemap back to check what was stored.
 */

call cdp.connection_sitemap_upsert (
    connection_id => '9cgaj0000012O5hAAE',
    sitemap => $$
        SalesforceInteractions.init().then(() => {
            SalesforceInteractions.initSitemap({ global: {}, pageTypeDefault: {}, pageTypes: [] });
        });
    $$
);

call cdp.connection_sitemap_get (connection_id => '9cgaj0000012O5hAAE');
