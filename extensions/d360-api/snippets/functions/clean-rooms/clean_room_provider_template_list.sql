/**
 * List the templates one provider offers, newest first, to choose the one a collaboration is built on.
 *
 * The same row shape as `clean_room_template_list`. The `name` feeds `template_name` of a collaboration and a specification, and the `id` feeds `template_version_id`.
 */

call cdp.clean_room_provider_template_list (
    provider_id_or_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462',
    order_by => 'created_date DESC',
    limit => 20
);
