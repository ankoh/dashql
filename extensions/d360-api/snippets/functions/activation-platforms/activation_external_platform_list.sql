/**
 * List the external platforms of the org, such as Google Ads or Meta, to find the name and prefix a target's connector needs.
 *
 * Values come in upper case here (`ACTIVE`, `ADVERTISING`). The items may have no `id`, so key on `name` and `key_prefix_name`. `batch_size` goes up to 20.
 */

call cdp.activation_external_platform_list (limit => 20, offset => 0, order_by => 'createdDate desc');
