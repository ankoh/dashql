/**
 * List the clean room providers, newest first, to find the one whose templates you want to use.
 *
 * `name` is what `clean_room_collaboration_create` takes as `provider_dev_name`. `template_names` can be empty, so read the templates with `clean_room_provider_template_list`.
 */

call cdp.clean_room_provider_list (order_by => 'created_date DESC', limit => 20);

call cdp.clean_room_provider_get (provider_id_or_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462');
