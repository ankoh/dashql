/**
 * See which kinds of data model objects can be activated in a data space, such as Profile or Engagement.
 *
 * The result is one row with a `categories` list. Leave `dataspace` out to use the data space of the request.
 */

call cdp.activation_data_object_category_list (dataspace => 'default');

call cdp.activation_channel_list (activate_on => 'ssot__Individual__dlm', dataspace => 'default');
