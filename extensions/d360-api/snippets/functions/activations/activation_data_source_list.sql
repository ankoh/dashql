/**
 * List the data sources behind a contact point DMO that fit a channel, to choose the sources and their priority for a contact point.
 *
 * The data space comes from the DMO. Despite the option text, the activation target here is a DMO and not an `activation_target`. The sample values look like API names.
 */

call cdp.activation_data_source_list (
    data_model_object_api_name => 'ssot__ContactPointEmail__dlm',
    channel => 'Email',
    filters => 'name contains Salesforce',
    order_by => 'name asc',
    batch_size => 50
);
