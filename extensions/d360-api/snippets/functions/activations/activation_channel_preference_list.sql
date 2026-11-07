/**
 * List the preference options a channel offers on a contact point DMO, to fill `data_source_preference` of a contact point.
 *
 * Both `channel` and the contact point DMO are required. The sample answers with `ANY`, `PERSONAL`, `BUSINESS` and `PRIMARY`.
 */

call cdp.activation_channel_preference_list (
    channel => 'Phone',
    data_model_object_api_name => 'ssot__ContactPointPhone__dlm'
);

call cdp.activation_channel_preference_list (
    channel => 'Email',
    data_model_object_api_name => 'ssot__ContactPointEmail__dlm'
);
