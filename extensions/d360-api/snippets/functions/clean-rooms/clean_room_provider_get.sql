/**
 * Read one clean room provider by its developer name or id.
 *
 * Find the name in the list of providers first.
 */

call cdp.clean_room_provider_list (order_by => 'created_date DESC', limit => 20);

call cdp.clean_room_provider_get (provider_id_or_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462');
