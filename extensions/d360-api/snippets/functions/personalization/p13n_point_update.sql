/**
 * Replace the decisions and settings of a point.
 *
 * It is a full `PUT`: send every required field, including the unchanged `name`, or the missing ones are gone. Read the point afterwards.
 */

call cdp.p13n_point_update (
    id_or_name => 'home_page_experience',
    name => 'home_page_experience',
    label => 'Updated Home Page Experience',
    dataspace_name => 'default',
    profile_data_graph_name => 'individual_profile',
    source => 'PersonalizationApp',
    is_authentication_required => false,
    schema_name => 'product_recommendations_schema',
    max_items_count => 15,
    decisions => [(
        name = 'default_decision',
        label = 'Default Decision',
        criteria = $${"type":"Criteria","operator":"AND","filters":[]}$$,
        attribute_values = [],
        personalizer_name = 'default_recommender',
        state = 'Live'
    )]
);

call cdp.p13n_point_get (id_or_name => 'home_page_experience');
