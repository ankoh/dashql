/**
 * List the activated Document AI configurations, newest label order first, a page at a time.
 *
 * The items carry no `schema_config`, read a single configuration for that. `search` narrows the list to records that contain a term, and `order_by` takes a field and a direction.
 */

call cdp.document_ai_configuration_list (
    activation_status => 'Activated',
    search => 'Invoice',
    order_by => 'Label DESC',
    limit => 25,
    offset => 0
);

call cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');
