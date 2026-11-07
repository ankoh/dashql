/**
 * Find the enabled Handlebars transformers for websites, for example to pick one for a new experience config.
 *
 * `source` defaults to `Organization`, so add `source => 'Global'` to see the global ones. The other filters are the schema, the category, the connector and the data space. Paging is by `limit` (1-299, default 50) and `offset`.
 */

call cdp.p13n_transformer_list (
    channel_type => 'WebApp',
    transformer_type => 'Handlebars',
    is_enabled => true,
    connector_name_or_id => 'my_website_connector',
    limit => 50,
    _pages => 2
);
