/**
 * Step 2 of personalization. It needs the transformer, the personalization point and the website connector.
 *
 * Check that the personalization point exists.
 */

call cdp.p13n_point_get (id_or_name => 'home_page_experience');
