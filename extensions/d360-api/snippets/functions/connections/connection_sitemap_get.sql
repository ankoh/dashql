/**
 * Read the Web SDK sitemap of a Streaming App connection, the data capture rules of a website.
 *
 * This is not the sitemap of the Web Content connector.
 */

call cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_sitemap_get (connection_id => '9cgaj0000012O5hAAE');
