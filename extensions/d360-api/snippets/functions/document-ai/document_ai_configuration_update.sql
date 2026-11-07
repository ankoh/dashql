/**
 * Change the description of a Document AI configuration and deactivate it.
 *
 * Only `label`, `description` and `activation_status` can change, which is `Activated` or `Deactivated`. To change the schema, model or file types, create a new configuration.
 */

call cdp.document_ai_configuration_update (
    id_or_api_name => 'Vendor_Invoice',
    label => 'Vendor Invoice (EU and US)',
    description => 'Supplier invoices, EU and US',
    activation_status => 'Deactivated'
);

call cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');
