/**
 * Browse the catalog of data model objects, a page at a time.
 *
 * The catalog has over a thousand DMOs, including ones the org doesn't use, and a big page is slow, so keep `limit` small. Then read one DMO in full.
 */

call cdp.dmo_list (limit => 50, order_by => 'ASC', _pages => 2);

call cdp.dmo_get (data_model_object_name => 'ssot__Individual__dlm');
