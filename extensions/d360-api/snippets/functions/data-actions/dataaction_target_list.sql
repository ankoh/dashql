/**
 * List the targets that data actions can send events to, a page at a time.
 *
 * This lists data action targets only, not activation targets. `type` and `status` can come back in upper case (`WEBHOOK`, `ACTIVE`), so compare them case-insensitively.
 */

call d360.dataaction_target_list (batch_size => 25, offset => 0, order_by => 'label ASC');

call d360.dataaction_target_get (api_name => 'contact_webhook');
