/**
 * List the experience configs of a website or app connector that render through one transformer, to see where its content is shown.
 *
 * The other filters are the personalization point and the data space. Paging is by `limit` (1-299, default 50) and `offset`.
 */

call cdp.p13n_experience_config_list (
    id_or_app_source_id_or_name => 'my_website_connector',
    transformer_name_or_id => 'promo_banner_transformer',
    dataspace_id_or_name => 'default',
    limit => 50,
    _pages => 3
);
