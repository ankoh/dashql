/**
 * List the data lake objects of the org, the raw tables that data streams ingest into. Reach for it to find the developer name of a DLO before reading or mapping it.
 *
 * To get every DLO, follow the next page: a short page is not the end, and a `limit` above 20 is cut to 20. `total_size` also counts system DLOs, so don't use it to detect missing ones.
 */

call cdp.dlo_list (limit => 20, order_by => 'ASC', _pages => 3);

call cdp.dlo_get (record_id_or_developer_name => 'Account_Home__dll');
