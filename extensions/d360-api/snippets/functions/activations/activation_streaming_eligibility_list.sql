/**
 * Ask whether a DMO can be activated as a stream, and why not when it can't.
 *
 * One row with `allowed` and, when that is false, a `reason`. `activation_create` accepts only `Batch` as the processing type, so this is a check to read, not a setting to use.
 */

call cdp.activation_streaming_eligibility_list (data_model_object_api_name => 'ssot__Individual__dlm');

call cdp.activation_data_object_category_list (dataspace => 'default');
