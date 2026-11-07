/**
 * List the specifications of the org, the mappings from template attributes to your DMO fields.
 *
 * `id` is what `clean_room_invitation_accept` takes as `specification_id`, and `name` is what `clean_room_collaboration_create` takes as `specification_dev_name`. `status` is `Active`, `Error`, `Inactive` or `Processing`.
 */

call cdp.clean_room_specification_list (order_by => 'created_date DESC', limit => 20);
