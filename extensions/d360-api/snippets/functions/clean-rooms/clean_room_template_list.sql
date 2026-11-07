/**
 * List the clean room templates of all providers, newest first, to see which use cases and match keys are on offer.
 *
 * Each member's required attributes are in `configuration.memberConfigs[].attributeConfigs`, and their `id` values feed `clean_room_specification_create`. `metadata_configuration` says who can trigger a query, receive results, contribute data and pay.
 */

call cdp.clean_room_template_list (order_by => 'created_date DESC', limit => 20);
