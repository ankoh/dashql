/**
 * Look up the fixed limits of related-attribute activations: attributes, DMOs, hops and values.
 *
 * One row. Pair it with the quota call, which tells you how many of the activations the org may have are in use.
 */

call cdp.activation_related_attribute_limit_list ();

call cdp.activation_related_attribute_quota_list ();
