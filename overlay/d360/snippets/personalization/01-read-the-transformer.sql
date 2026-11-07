/**
 * Step 1 of personalization. It needs the transformer, the personalization point and the website connector.
 *
 * Check that the transformer exists.
 */

CALL cdp.p13n_transformer_get (id_or_name => 'promo_banner_transformer');
