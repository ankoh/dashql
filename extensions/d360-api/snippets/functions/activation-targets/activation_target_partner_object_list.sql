/**
 * List the objects of one type that live on the partner platform of a target, such as the conversion rules of LinkedIn.
 *
 * Results are paged by cursor: follow `next_page_url` instead of building `page_token`. Don't filter on `status`, which can be null.
 */

call cdp.activation_target_partner_object_list (
    activation_target_id => '85UVF000000NaQz2AK',
    partner_object_type => 'ConversionRule'
);

call cdp.activation_target_get (activation_target_id => '85UVF000000NaQz2AK');
