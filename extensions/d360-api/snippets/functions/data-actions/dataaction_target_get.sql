/**
 * Read one data action target by its developer name, for instance to see whether it has reached `Active`.
 *
 * `config` depends on the type: a `WebHook` target returns `target_endpoint`. Don't diff it against what you sent for a `Core` target, which doesn't keep an endpoint.
 */

call d360.dataaction_target_list (batch_size => 25, order_by => 'label ASC');

call d360.dataaction_target_get (api_name => 'contact_webhook');
