<!-- Generated from overlay/d360/api/personalization.yaml, edit that and run: bazel run //overlay/d360:update -->

# Personalization

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

This family configures Salesforce Personalization: which content a website or mobile app shows, to whom, and how it renders. It's setup only. The runtime call that asks for a decision is the [Decisioning API](https://developer.salesforce.com/docs/marketing/einstein-personalization/guide/decisioning-api-reference.md), which has no function here.

None of these paths is in the spec. [sf-pi's parity report](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/connect-openapi-parity.md) lists all 21 as outside the contract. Options come from [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java), whose [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/PersonalizationToolsTest.java) mock HTTP, and no source shows a real response.

Two chains meet in the experience config:

- **What to show:** data space and profile data graph, content DMO, schema, then point. Point decisions name personalizers, which no function here creates.
- **How and where:** Streaming App data connector (the site or app), transformer, experience config, then a mobile preview to test it.

Gotchas:

- Keys differ. Experience configs need the connector plus a unique name. Transformers take `id_or_name` as a query parameter on a singular `/transformer` path.
- Points update with a full `PUT`, schemas with `PATCH`. The tool text calls the transformer and experience config `PUT`s partial.
- Schemas and points have no list call.
- The data space option is `dataspace_name`, `dataspace`, `dataspace_value`, `dataspace_id_or_name` or `dataspace_id`, depending on the object.
- Deletes can't be undone, and no source says the server checks for references.

```sql
CALL cdp.p13n_transformer_get (id_or_name => 'promo_banner_transformer');
CALL cdp.p13n_point_get (id_or_name => 'home_page_experience');
CALL cdp.p13n_experience_config_create (
    id_or_app_source_id_or_name => 'my_website_connector',
    name => 'homepage_hero_banner',
    label => 'Homepage Hero Banner',
    data_provider => (type = 'PersonalizationPoint', reference_type = 'ApiName', value = 'home_page_experience'),
    source_matchers => [(type = 'ContentZone', value = 'hero_section')],
    transformation_config => (when = 'Immediately', method = 'ReplaceContentZoneContent', transformations = [(transformer_name = 'promo_banner_transformer')])
);
```

**Functions:** [`p13n_engagement_signals_list`](#p13n_engagement_signals_list), [`p13n_org_info_get`](#p13n_org_info_get), [`p13n_mobile_preview_create`](#p13n_mobile_preview_create), [`p13n_experience_config_list`](#p13n_experience_config_list), [`p13n_experience_config_get`](#p13n_experience_config_get), [`p13n_experience_config_create`](#p13n_experience_config_create), [`p13n_experience_config_update`](#p13n_experience_config_update), [`p13n_experience_config_delete`](#p13n_experience_config_delete), [`p13n_transformer_list`](#p13n_transformer_list), [`p13n_transformer_get`](#p13n_transformer_get), [`p13n_transformer_create`](#p13n_transformer_create), [`p13n_transformer_update`](#p13n_transformer_update), [`p13n_transformer_delete`](#p13n_transformer_delete), [`p13n_schema_create`](#p13n_schema_create), [`p13n_schema_get`](#p13n_schema_get), [`p13n_schema_update`](#p13n_schema_update), [`p13n_schema_delete`](#p13n_schema_delete), [`p13n_point_create`](#p13n_point_create), [`p13n_point_get`](#p13n_point_get), [`p13n_point_update`](#p13n_point_update), [`p13n_point_delete`](#p13n_point_delete)

## p13n_engagement_signals_list

`GET /personalization/engagement-signals` · tool `d360_p13n_engagement_signals_list` · evidence S · read-only

Lists the engagement signals configured for a personalization data graph, such as click, view, purchase or add-to-cart. They feed recommender attribution and objective optimization, so read them before configuring a recommender.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_id` | `dataSpaceId` | query | string | yes | Data Space ID — the isolated workspace the recommender operates in |
| `data_graph_id` | `dataGraphId` | query | string | yes | Data Graph ID — the profile or item data graph to query signals for |

```sql
CALL cdp.p13n_engagement_signals_list (dataspace_id => 'default', data_graph_id => 'user_profile_graph');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Despite the names, the [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) passes names here: `default` and `user_profile_graph`. It says both options are required, while [sf-pi's overrides](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/overrides.json) mark both optional and add `limit` and `offset`. The [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/PersonalizationToolsTest.java) mock `engagementSignals` with `id`, `name` and `type`, plus `total_size`, but that's fixture data.

## p13n_org_info_get

`GET /personalization/external-apps/org` · tool `d360_p13n_org_info_get` · evidence S · read-only

Returns the org's Data Cloud Tenant Specific Endpoint. Use it to confirm the endpoint before configuring personalization.

**Options**

None.

```sql
CALL cdp.p13n_org_info_get ();
```

**Result**

One row, from the output class [`CurrentOrgInfoRepresentation`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/CurrentOrgInfoRepresentation.java). Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dc_tse` | `dcTse` | VARCHAR | Data Cloud Tenant Specific Endpoint. |

**Notes:** [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/readiness.ts) probes this path to report whether personalization is available in an org, so it can serve as a feature check.

## p13n_mobile_preview_create

`POST /personalization/external-apps/mobile/live-preview-link` · tool `d360_p13n_mobile_preview_create` · evidence S · changes org state

Generates a time-limited link for previewing an experience config or transformer in a mobile app, before deploying it.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_connector_id` | `dataConnectorId` | body | string | yes | Streaming App data connector id. Required to resolve the preview base URL. |
| `experience_config` | `experienceConfig` | body | [PersonalizationExperienceConfig](#personalizationexperienceconfig) |  | Experience config to preview. Send this or `transformer`, not both. |
| `transformer` | `transformer` | body | [PersonalizationTransformer](#personalizationtransformer) |  | Transformer to preview. Send this or `experience_config`, not both. |
| `decision_request_body` | `decisionRequestBody` | body | [PersonalizationDecisionRequestBody](#personalizationdecisionrequestbody) |  | Decision request used to generate the preview. |

```sql
CALL cdp.p13n_mobile_preview_create (
    data_connector_id => 'mobile_app_connector_123',
    experience_config => (
        name = 'test_experience',
        label = 'Test Experience',
        data_provider = (type = 'PersonalizationPoint', reference_type = 'ApiName', value = 'product_recs'),
        source_matchers = [(type = 'ContentZone', value = 'product_list')],
        transformation_config = (when = 'Immediately', method = 'ReplaceContentZoneContent', transformations = [(transformer_name = 'product_card_transformer')])
    ),
    decision_request_body => (
        p = (decision_id = 'rec_decision_001', cohort_id = 'cohort_A', experiment_id = 'exp_123'),
        c = (individual_id = 'ind_456', anchor_id = 'anchor_789')
    )
);
```

**Result**

One row, from the output class [`ExtAppPreviewAuthRepresentation`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/ExtAppPreviewAuthRepresentation.java). Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `preview_url` | `previewUrl` | VARCHAR | Preview link. It's time-limited. |
| `expires_at` | `expiresAt` | TIMESTAMPTZ | When the link expires. The class types it as a string, and the test mock is ISO 8601. |

**Notes:** The [low-code mobile guide](https://developer.salesforce.com/docs/marketing/einstein-personalization/guide/personalize-mobile-experiences-lowcode.md) says live previews need a custom URL schema configured in the app. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/overrides.json) requires confirmation for this call until it's verified as ephemeral.

## p13n_experience_config_list

`GET /personalization/external-apps/{id}/personalization-experience-configs` · tool `d360_p13n_experience_config_list` · evidence S · read-only

Lists a data connector's experience configs, optionally filtered by point, transformer or data space. An experience config defines what personalized content to show and where.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_app_source_id_or_name` | `id` | path | string | yes | Unique id, appSourceId or name of Streaming App Data Connector |
| `limit` | `limit` | query | integer |  | Limits the number returned (1-299, default 50) |
| `offset` | `offset` | query | integer |  | Number to skip (default 0) |
| `personalization_point_name_or_id` | `personalizationPointNameOrId` | query | string |  | Filter by personalization point name or ID |
| `transformer_name_or_id` | `transformerNameOrId` | query | string |  | Filter by transformer name or ID |
| `dataspace_id_or_name` | `dataSpaceIdOrName` | query | string |  | Filter by data space ID or name |
| `is_wpm_url_required` | `isWpmUrlRequired` | query | boolean |  | Include Web Personalization Manager URLs in response (default false) |

```sql
CALL cdp.p13n_experience_config_list (id_or_app_source_id_or_name => 'my_website_connector', transformer_name_or_id => 'promo_banner_transformer', limit => 50);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Paging:** `limit` (1-299, default 50) and `offset` (default 0).

**Notes:** The [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/PersonalizationToolsTest.java) mock `personalizationExperienceConfigs` with `total_size`, but that's fixture data. No source gives the field that holds the Web Personalization Manager URL from `is_wpm_url_required`.

## p13n_experience_config_get

`GET /personalization/external-apps/{id}/personalization-experience-configs/{name}` · tool `d360_p13n_experience_config_get` · evidence S · read-only

Returns one experience config by name, with its data provider, source matchers and transformation configuration.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_app_source_id_or_name` | `id` | path | string | yes | Unique id, appSourceId or name of Streaming App Data Connector |
| `name_param` | `name` | path | string | yes | Unique name of Personalization Experience Config to retrieve |
| `is_wpm_url_required` | `isWpmUrlRequired` | query | boolean |  | Include Web Personalization Manager URL in response (default false) |

```sql
CALL cdp.p13n_experience_config_get (id_or_app_source_id_or_name => 'my_website_connector', name_param => 'homepage_hero_banner', is_wpm_url_required => true);
```

**Result**

One row. No source shows a real response. These columns are the attributes of the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/PersonalizationExperienceConfigInputRepresentation.java), which marks the audit fields read-only, and the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) says the call returns the complete config. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Config id. Read-only. |
| `name` | `name` | VARCHAR | Unique name. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `data_provider` | `dataProvider` | JSON | [PersonalizationDataProvider](#personalizationdataprovider). |
| `source_matchers` | `sourceMatchers` | JSON | Array of [PersonalizationSourceMatcher](#personalizationsourcematcher). |
| `transformation_config` | `transformationConfig` | JSON | [PersonalizationTransformationConfig](#personalizationtransformationconfig). |
| `is_enabled` | `isEnabled` | BOOLEAN | Whether this configuration is enabled. |
| `display_url` | `displayUrl` | VARCHAR | Page to display the config on when editing. |
| `published_date` | `publishedDate` | TIMESTAMPTZ | When the config was last published. |
| `created_by_id` | `createdById` | VARCHAR | User who created it. |
| `created_date` | `createdDate` | TIMESTAMPTZ | When it was created. |
| `last_modified_by_id` | `lastModifiedById` | VARCHAR | User who last modified it. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | When it was last modified. |

**Notes:** The key is the name only: `name_param` isn't documented as accepting an id. No source gives the field that holds the Web Personalization Manager URL from `is_wpm_url_required`.

## p13n_experience_config_create

`POST /personalization/external-apps/{id}/personalization-experience-configs` · tool `d360_p13n_experience_config_create` · evidence S · changes org state

Creates an experience config on a data connector: what content to show (`data_provider`), where to show it (`source_matchers`) and how to render it (`transformation_config`). The connector, transformer and point must exist.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_app_source_id_or_name` | `id` | path | string | yes | Unique id, appSourceId or name of Streaming App Data Connector |
| `name` | `name` | body | string |  | Unique name of the config. Other calls address it by this name through `name_param`. |
| `label` | `label` | body | string |  | - |
| `description` | `description` | body | string |  | - |
| `data_provider` | `dataProvider` | body | [PersonalizationDataProvider](#personalizationdataprovider) |  | What is supplying the data for this experience. |
| `source_matchers` | `sourceMatchers` | body | array of [PersonalizationSourceMatcher](#personalizationsourcematcher) |  | How to find where this personalization occurs. For web, which pages. |
| `transformation_config` | `transformationConfig` | body | [PersonalizationTransformationConfig](#personalizationtransformationconfig) |  | How the provider's data is transformed and when. |
| `is_enabled` | `isEnabled` | body | boolean |  | Whether this configuration is enabled. |
| `display_url` | `displayUrl` | body | string |  | When editing this configuration on the website, which page to display it on if not the current page. |
| `disable_related_experiences` | `disableRelatedExperiences` | query | boolean |  | Disable other experiences in the same content zone (default false) |

```sql
CALL cdp.p13n_experience_config_create (
    id_or_app_source_id_or_name => 'my_website_connector',
    name => 'homepage_hero_banner',
    label => 'Homepage Hero Banner Personalization',
    is_enabled => true,
    data_provider => (
        type = 'PersonalizationPoint',
        reference_type = 'ApiName',
        value = 'hero_banner_recommendations',
        dataspace_reference_type = 'ApiName',
        dataspace_value = 'default',
        group_by_type = 'DataGraph',
        group_by_reference_type = 'ApiName',
        group_by_value = 'user_profile_graph'
    ),
    source_matchers => [(type = 'PageUrlMatcher', value = '/home'), (type = 'ContentZone', value = 'hero_section')],
    transformation_config => (
        render_if_empty = false,
        when = 'Immediately',
        method = 'ReplaceContentZoneContent',
        engagement_destination = 'banner_click_destination',
        transformations = [(
            transformer_name = 'promo_banner_transformer',
            substitutions = (bannerTitle = '{{data.title}}', bannerImage = '{{data.image}}', ctaText = 'Learn More')
        )]
    ),
    display_url => '/home'
);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** No source says which attributes the server enforces, so none is marked required. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) names `name`, `label`, `data_provider`, `source_matchers` and `transformation_config`. The [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/PersonalizationExperienceConfigInputRepresentation.java) also has `id`, `published_date`, `created_by_id`, `created_date`, `last_modified_by_id` and `last_modified_date`, marked read-only and ignored on input, so they aren't options.

The [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) mixes a URL matcher and a content zone in one `source_matchers` list, and no source says whether they combine as AND or OR. It also writes substitution values as `{{data.title}}`, while the transformer example uses `{{recommendation.title}}`, and no source defines either root. Web content zones are defined in the [Interactions SDK Sitemap](https://developer.salesforce.com/docs/marketing/einstein-personalization/guide/set-up-content-zones.md).

## p13n_experience_config_update

`PUT /personalization/external-apps/{id}/personalization-experience-configs/{name}` · tool `d360_p13n_experience_config_update` · evidence S · changes org state

Changes an experience config, for example to turn it on or off with `is_enabled`. The connector and name identify it.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_app_source_id_or_name` | `id` | path | string | yes | Unique id, appSourceId or name of Streaming App Data Connector |
| `name_param` | `name` | path | string | yes | Unique name of Personalization Experience Config to update |
| `name` | `name` | body | string |  | Unique name of the config. Other calls address it by this name through `name_param`. |
| `label` | `label` | body | string |  | - |
| `description` | `description` | body | string |  | - |
| `data_provider` | `dataProvider` | body | [PersonalizationDataProvider](#personalizationdataprovider) |  | What is supplying the data for this experience. |
| `source_matchers` | `sourceMatchers` | body | array of [PersonalizationSourceMatcher](#personalizationsourcematcher) |  | How to find where this personalization occurs. For web, which pages. |
| `transformation_config` | `transformationConfig` | body | [PersonalizationTransformationConfig](#personalizationtransformationconfig) |  | How the provider's data is transformed and when. |
| `is_enabled` | `isEnabled` | body | boolean |  | Whether this configuration is enabled. |
| `display_url` | `displayUrl` | body | string |  | When editing this configuration on the website, which page to display it on if not the current page. |
| `disable_related_experiences` | `disableRelatedExperiences` | query | boolean |  | Disable other experiences in the same content zone (default false) |

```sql
CALL cdp.p13n_experience_config_update (id_or_app_source_id_or_name => 'my_website_connector', name_param => 'homepage_hero_banner', is_enabled => false);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The verb is `PUT`, but the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) and [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) call it a partial update where every field is optional. Check that on an org before relying on omitted fields staying as they are.

## p13n_experience_config_delete

`DELETE /personalization/external-apps/{id}/personalization-experience-configs/{name}` · tool `d360_p13n_experience_config_delete` · evidence S · changes org state

Deletes an experience config, which stops its delivery to the app. This can't be undone.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_app_source_id_or_name` | `id` | path | string | yes | Unique id, appSourceId or name of Streaming App Data Connector |
| `name_param` | `name` | path | string | yes | Unique name of Personalization Experience Config to delete |

```sql
CALL cdp.p13n_experience_config_delete (id_or_app_source_id_or_name => 'my_website_connector', name_param => 'homepage_hero_banner');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) drops the HTTP response and returns its own `status` JSON, so that shape isn't the API's.

## p13n_transformer_list

`GET /personalization/external-apps/transformers` · tool `d360_p13n_transformer_list` · evidence S · read-only

Lists transformers, which define how content renders through HTML templates, scripts or mobile components. Filter by source, schema, category, channel, type, enabled status, connector, data space or attachment.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Limits the number returned (1-299, default 50) |
| `offset` | `offset` | query | integer |  | Number to skip (default 0) |
| `source` | `source` | query | string |  | Source: Global or Organization (default Organization) |
| `schema_reference` | `schemaReference` | query | string |  | Filter by personalization schema reference |
| `transformer_category` | `transformerCategory` | query | string |  | Filter by category: EmbeddedContent or Agent |
| `channel_type` | `channelType` | query | string |  | Filter by channel: MobileApp or WebApp |
| `transformer_type` | `transformerType` | query | string |  | Filter by type: Handlebars, HtmlElementModifier, AgentScript, or Component |
| `is_enabled` | `isEnabled` | query | boolean |  | Filter by enabled status |
| `connector_name_or_id` | `connectorNameOrId` | query | string |  | Filter by data connector name or ID |
| `dataspace_id_or_name` | `dataSpaceIdOrName` | query | string |  | Filter by data space ID or name |
| `is_data_connector_attached` | `isDataConnectorAttached` | query | boolean |  | Filter by attachment status. When false, returns unattached transformers. Combine with connector_name_or_id to get transformers matching that connector OR unattached |

```sql
CALL cdp.p13n_transformer_list (channel_type => 'WebApp', transformer_type => 'Handlebars', is_enabled => true);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Paging:** `limit` (1-299, default 50) and `offset` (default 0).

**Notes:** `source` defaults to `Organization`, so Global transformers need `source => 'Global'`. The [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/PersonalizationToolsTest.java) mock `transformers` with `total_size`, but that's fixture data.

## p13n_transformer_get

`GET /personalization/external-apps/transformer` · tool `d360_p13n_transformer_get` · evidence S · read-only

Returns one transformer by id or name, with its substitution definitions, type details and data connectors.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | query | string | yes | Unique id or name of Personalization Transformer to retrieve |

```sql
CALL cdp.p13n_transformer_get (id_or_name => 'promo_banner_transformer');
```

**Result**

One row. No source shows a real response. These columns are the attributes of the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/TransformerInputRepresentation.java), and the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) says the call returns the complete transformer. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Transformer id. Only the test mock shows this field. |
| `name` | `name` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `data_connectors` | `dataConnectors` | JSON | Array of associated data connectors. |
| `channel` | `channel` | VARCHAR | `MobileApp` or `WebApp`. |
| `substitution_definitions` | `substitutionDefinitions` | JSON | Map of variable name to [PersonalizationSubstitution](#personalizationsubstitution). |
| `schema_reference` | `schemaReference` | VARCHAR | Name of the schema the definitions were created from. |
| `dataspace` | `dataSpace` | VARCHAR | Name of the data space. |
| `is_enabled` | `isEnabled` | BOOLEAN | Whether it's enabled when delivered. |
| `transformer_type` | `transformerType` | VARCHAR | `Handlebars`, `HtmlElementModifier`, `AgentScript` or `Component`. |
| `thumbnail_image` | `thumbnailImage` | VARCHAR | URL or base64-encoded image. |
| `transformer_type_details` | `transformerTypeDetails` | JSON | [PersonalizationTransformerDetails](#personalizationtransformerdetails). |

## p13n_transformer_create

`POST /personalization/external-apps/transformers` · tool `d360_p13n_transformer_create` · evidence S · changes org state

Creates a transformer: a template, script, HTML modifier or mobile component that renders personalized content, with substitution variables that each experience can customize.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | body | string |  | Experience configs reference it through `transformer_name`. |
| `label` | `label` | body | string |  | - |
| `description` | `description` | body | string |  | - |
| `data_connectors` | `dataConnectors` | body | array of string |  | Websites or mobile apps this transformer belongs to: id, name or appSourceId of a Streaming App data connector. |
| `channel` | `channel` | body | enum(MobileApp, WebApp) |  | Whether the transformer is for a website or a mobile app. |
| `substitution_definitions` | `substitutionDefinitions` | body | map to [PersonalizationSubstitution](#personalizationsubstitution) |  | Substitution variables that experiences can customize. The key is the variable name. |
| `schema_reference` | `schemaReference` | body | string |  | Name of the schema the substitution definitions were created from. It lets UIs offer an optional guardrail when selecting points for an experience. |
| `dataspace` | `dataSpace` | body | string |  | Name of the data space the transformer belongs to. |
| `is_enabled` | `isEnabled` | body | boolean |  | Whether the transformer is enabled when delivered to the app or website. |
| `transformer_type` | `transformerType` | body | enum(Handlebars, HtmlElementModifier, AgentScript, Component) |  | Tells the SDK how the transformer works and what code renders it. |
| `thumbnail_image` | `thumbnailImage` | body | string |  | Thumbnail image, as a URL or base64-encoded data. |
| `transformer_type_details` | `transformerTypeDetails` | body | [PersonalizationTransformerDetails](#personalizationtransformerdetails) |  | Data specific to `transformer_type`. |

```sql
CALL cdp.p13n_transformer_create (
    name => 'promo_banner_transformer',
    label => 'Promotional Banner Transformer',
    channel => 'WebApp',
    transformer_type => 'Handlebars',
    is_enabled => true,
    data_connectors => ['my_website_connector'],
    dataspace => 'default',
    substitution_definitions => (
        bannerTitle = (label = 'Banner Title', configType = 'SchemaPath', defaultValue = '{{recommendation.title}}', overridable = true, required = true),
        ctaText = (label = 'Call to Action Text', configType = 'Static', defaultValue = 'Shop Now', overridable = true, required = true)
    ),
    transformer_type_details => (
        html = $$<div class="promo-banner"><h2>{{bannerTitle}}</h2><button class="cta-button">{{ctaText}}</button></div>$$,
        disable_auto_injection_of_engagement_attributes = false
    )
);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** No source says which attributes the server enforces, so none is marked required. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) names `name`, `label`, `description`, `channel`, `transformer_type`, `substitution_definitions` and `transformer_type_details`. For a `Component`, the [low-code mobile guide](https://developer.salesforce.com/docs/marketing/einstein-personalization/guide/personalize-mobile-experiences-lowcode.md) says the SDK matches the backend's component name against the components allowed in the app's `ContentZone`.

## p13n_transformer_update

`PUT /personalization/external-apps/transformer` · tool `d360_p13n_transformer_update` · evidence S · changes org state

Changes a transformer, identified by id or name.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | query | string | yes | Unique id or name of Personalization Transformer to update |
| `name` | `name` | body | string |  | Experience configs reference it through `transformer_name`. |
| `label` | `label` | body | string |  | - |
| `description` | `description` | body | string |  | - |
| `data_connectors` | `dataConnectors` | body | array of string |  | Websites or mobile apps this transformer belongs to: id, name or appSourceId of a Streaming App data connector. |
| `channel` | `channel` | body | enum(MobileApp, WebApp) |  | Whether the transformer is for a website or a mobile app. |
| `substitution_definitions` | `substitutionDefinitions` | body | map to [PersonalizationSubstitution](#personalizationsubstitution) |  | Substitution variables that experiences can customize. The key is the variable name. |
| `schema_reference` | `schemaReference` | body | string |  | Name of the schema the substitution definitions were created from. It lets UIs offer an optional guardrail when selecting points for an experience. |
| `dataspace` | `dataSpace` | body | string |  | Name of the data space the transformer belongs to. |
| `is_enabled` | `isEnabled` | body | boolean |  | Whether the transformer is enabled when delivered to the app or website. |
| `transformer_type` | `transformerType` | body | enum(Handlebars, HtmlElementModifier, AgentScript, Component) |  | Tells the SDK how the transformer works and what code renders it. |
| `thumbnail_image` | `thumbnailImage` | body | string |  | Thumbnail image, as a URL or base64-encoded data. |
| `transformer_type_details` | `transformerTypeDetails` | body | [PersonalizationTransformerDetails](#personalizationtransformerdetails) |  | Data specific to `transformer_type`. |

```sql
CALL cdp.p13n_transformer_update (id_or_name => 'promo_banner_transformer', is_enabled => true, label => 'Updated Banner Transformer');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The verb is `PUT`, but the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) calls it a partial update where every field is optional. Changing `transformer_type` may require changing `transformer_type_details` to match.

## p13n_transformer_delete

`DELETE /personalization/external-apps/transformer` · tool `d360_p13n_transformer_delete` · evidence S · changes org state

Deletes a transformer. Experience configs that reference it break, and this can't be undone, so check for active experiences first.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | query | string | yes | Unique id or name of Personalization Transformer to delete |

```sql
CALL cdp.p13n_transformer_delete (id_or_name => 'promo_banner_transformer');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** To find references, use [`p13n_experience_config_list`](#p13n_experience_config_list) with `transformer_name_or_id`, once per connector. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) drops the HTTP response and returns its own `status` JSON, so that shape isn't the API's.

## p13n_schema_create

`POST /personalization/personalization-schemas` · tool `d360_p13n_schema_create` · evidence S · changes org state

Creates a personalization schema, which defines the structure of personalized content: its attributes, content object and related objects. The data space and content DMO must exist.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | body | string |  | Points reference it through `schema_name`, transformers through `schema_reference`. |
| `label` | `label` | body | string |  | - |
| `description` | `description` | body | string |  | - |
| `dataspace_name` | `dataSpaceName` | body | string |  | API name of the data space associated with the schema. |
| `personalization_type` | `personalizationType` | body | enum(ExperienceVariation, FlowPath, ManualContent, Recommendations) |  | `ExperienceVariation` is for A/B test variations, `FlowPath` for flow branches, `ManualContent` for curated content, `Recommendations` for ML-driven content. |
| `attributes` | `attributes` | body | array of [PersonalizationAttribute](#personalizationattribute) |  | Custom variables that point decisions set through `attribute_values`. |
| `content_object` | `contentObject` | body | [PersonalizationContentObject](#personalizationcontentobject) |  | The content object (DMO) to personalize with, and its fields. |
| `related_content_objects` | `relatedContentObjects` | body | array of [PersonalizationRelatedContentObject](#personalizationrelatedcontentobject) |  | Related content objects, which can nest. |

```sql
CALL cdp.p13n_schema_create (
    name => 'product_recommendations_schema',
    label => 'Product Recommendations Schema',
    dataspace_name => 'default',
    personalization_type => 'Recommendations',
    attributes => [
        (name = 'recommendation_type', label = 'Recommendation Type', default_value = 'similar_items'),
        (name = 'priority_score', label = 'Priority Score')
    ],
    content_object => (name = 'Product__dll', field_names = ['name', 'description', 'price', 'image_url', 'category']),
    related_content_objects => [(content_object_name = 'ProductReviews__dll', field_names = ['rating', 'review_count'])]
);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The MCP tool takes this body as a raw JSON string. The attributes come from an unused [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/PersonalizationSchemaInputRepresentation.java) and the [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json). No source says which attributes the server enforces, so none is marked required. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) names `name`, `label`, `description`, `dataspace_name`, `personalization_type`, `attributes` and `content_object`.

The tool text and class say `content_object` is a DMO, but the payload example and tests use `Product__dll`. `__dll` is the DLO suffix, and DMOs end in `__dlm`. The [Schema DMO](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationschemadmo-dmo.md) reference says the type is usually `Recommendation`, singular, against `Recommendations` here.

## p13n_schema_get

`GET /personalization/personalization-schemas/{idOrName}` · tool `d360_p13n_schema_get` · evidence S · read-only

Returns one schema by id or name, with its attributes, content object and related content objects. Use it to inspect a schema before creating points.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique id or name of Personalization Schema to retrieve |

```sql
CALL cdp.p13n_schema_get (id_or_name => 'product_recommendations_schema');
```

**Result**

One row. No source shows a real response. These columns are the attributes of the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/personalization/PersonalizationSchemaInputRepresentation.java), and the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) says the call returns the complete schema. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Schema id. Only the test mock shows this field. |
| `name` | `name` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace_name` | `dataSpaceName` | VARCHAR | API name of the data space. |
| `personalization_type` | `personalizationType` | VARCHAR | `ExperienceVariation`, `FlowPath`, `ManualContent` or `Recommendations`. |
| `attributes` | `attributes` | JSON | Array of [PersonalizationAttribute](#personalizationattribute). |
| `content_object` | `contentObject` | JSON | [PersonalizationContentObject](#personalizationcontentobject). |
| `related_content_objects` | `relatedContentObjects` | JSON | Array of [PersonalizationRelatedContentObject](#personalizationrelatedcontentobject). |

**Notes:** No source has a list call for schemas. The docs describe a [`ssot__PersonalizationSchema__dlm`](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationschemadmo-dmo.md) DMO with `Name`, `PersonalizationType` and `IsActive`, which a `SELECT` over the connection could read, but they don't say it holds every schema created here.

## p13n_schema_update

`PATCH /personalization/personalization-schemas/{idOrName}` · tool `d360_p13n_schema_update` · evidence S · changes org state

Changes a schema's attributes, content object or related objects. Points that use the schema may be affected.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique id or name of Personalization Schema to update |
| `name` | `name` | body | string |  | Points reference it through `schema_name`, transformers through `schema_reference`. |
| `label` | `label` | body | string |  | - |
| `description` | `description` | body | string |  | - |
| `dataspace_name` | `dataSpaceName` | body | string |  | API name of the data space associated with the schema. |
| `personalization_type` | `personalizationType` | body | enum(ExperienceVariation, FlowPath, ManualContent, Recommendations) |  | `ExperienceVariation` is for A/B test variations, `FlowPath` for flow branches, `ManualContent` for curated content, `Recommendations` for ML-driven content. |
| `attributes` | `attributes` | body | array of [PersonalizationAttribute](#personalizationattribute) |  | Custom variables that point decisions set through `attribute_values`. |
| `content_object` | `contentObject` | body | [PersonalizationContentObject](#personalizationcontentobject) |  | The content object (DMO) to personalize with, and its fields. |
| `related_content_objects` | `relatedContentObjects` | body | array of [PersonalizationRelatedContentObject](#personalizationrelatedcontentobject) |  | Related content objects, which can nest. |

```sql
CALL cdp.p13n_schema_update (id_or_name => 'product_recommendations_schema', label => 'Updated Product Recommendations', attributes => [(name = 'new_attribute', label = 'New Attribute', default_value = 'default_value')]);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) says this can add attributes, but no source says whether `attributes` merges with or replaces the existing list.

## p13n_schema_delete

`DELETE /personalization/personalization-schemas/{idOrName}` · tool `d360_p13n_schema_delete` · evidence S · changes org state

Deletes a schema. Points that reference it break, and this can't be undone, so check for active points first.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique id or name of Personalization Schema to delete |

```sql
CALL cdp.p13n_schema_delete (id_or_name => 'product_recommendations_schema');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) drops the HTTP response and returns its own `status` JSON, so that shape isn't the API's.

## p13n_point_create

`POST /personalization/personalization-points` · tool `d360_p13n_point_create` · evidence S · changes org state

Creates a personalization point: a set of prioritized decision rules whose attribute values determine the content or experience at that point. The data space, profile data graph and schema must exist.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | body | string | yes | API name. It can't change after creation. |
| `label` | `label` | body | string | yes | - |
| `description` | `description` | body | string |  | - |
| `dataspace_name` | `dataSpaceName` | body | string | yes | API name of the data space. |
| `profile_data_graph_name` | `profileDataGraphName` | body | string | yes | Profile data graph the point targets. It must exist. |
| `source` | `source` | body | enum(BlockBuilder, ExperienceBuilder, FlowBuilder, PersonalizationApp) | yes | Where the point is defined: Email Builder blocks, Digital Experiences, Flow decisions or the Personalization app. |
| `is_authentication_required` | `isAuthenticationRequired` | body | boolean | yes | Whether API calls require user authentication. |
| `schema_name` | `schemaName` | body | string |  | A custom schema. Use `schema_enum` for a standard one. |
| `schema_enum` | `schemaEnum` | body | enum(DecisionDefined, ExperienceVariation, FlowPath) |  | A standard schema, in place of `schema_name`. |
| `max_items_count` | `maxItemsCount` | body | integer |  | The maximum number of items for this point. |
| `decisions` | `decisions` | body | array of [PersonalizationDecision](#personalizationdecision) | yes | Prioritized rules with criteria and attribute values. |

```sql
CALL cdp.p13n_point_create (
    name => 'home_page_experience',
    label => 'Home Page Experience Point',
    dataspace_name => 'default',
    profile_data_graph_name => 'individual_profile',
    source => 'PersonalizationApp',
    is_authentication_required => true,
    schema_name => 'product_recommendations_schema',
    max_items_count => 10,
    decisions => [
        (
            name = 'premium_decision',
            label = 'Premium User Decision',
            criteria = $${"type":"Criteria","operator":"AND","filters":[{"type":"Filter","operator":"EQUALS","subject":{"fieldApiName":"Segment__c","objectApiName":"Individual__dll"},"values":["Premium"]}]}$$,
            attribute_values = [(attribute_name = 'recommendation_type', value = 'premium_products')],
            personalizer_name = 'premium_recommender',
            state = 'Live'
        ),
        (
            name = 'default_decision',
            label = 'Default Decision',
            criteria = $${"type":"Criteria","operator":"AND","filters":[]}$$,
            attribute_values = [(attribute_name = 'recommendation_type', value = 'popular_items')],
            personalizer_name = 'default_recommender',
            state = 'Live'
        )
    ]
);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Done when:** `p13n_point_get.status` is `Active`, or `Error` on failure. The field name comes from a [test mock](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/PersonalizationToolsTest.java) and the tool's mention of a "current sync status". The values come from the [Point DMO](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationpointdmo-dmo.md), which lists `Processing`, `Active`, `Error` and `Deleting` as the pipeline's status.

**Notes:** The MCP tool takes this body as a raw JSON string, and no request class exists. The attributes come from the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java), the [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) and the [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/PersonalizationToolsTest.java). The required marks follow the tool text, which calls only `schema_name` and `schema_enum` optional, even though it also says a schema must exist.

**Decision order:** the [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) says "first matching criteria wins". The [Decision DMO](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationdecisiondmo-dmo.md) says the decision with the highest priority value is used, and the lowest priority is 1. No source here has a priority attribute, so test which rule applies.

**Spelling:** the DMO docs write `source` as `PERSONALIZATION_APP` and `EXPERIENCE_BUILDER`, and the state as `Draft` and `LIVE`. The tool text and example use `PersonalizationApp`, `ExperienceBuilder` and `Live`.

**Personalizers:** no function here creates what `personalizer_name` refers to. The spec's [`datakit_deploy`](data_kits.md#datakit_deploy) has `PersonalizationRecommender`, `PersonalizationObjective`, `PersonalizationPoint` and `PersonalizationSchema` component types.

The [Decisioning API](https://developer.salesforce.com/docs/marketing/einstein-personalization/guide/decisioning-api-request-personalization.md) requires all points in one request to use the same profile data graph, so `profile_data_graph_name` limits which points can be requested together.

## p13n_point_get

`GET /personalization/personalization-points/{idOrName}` · tool `d360_p13n_point_get` · evidence S · read-only

Returns one point by id or name, with its decisions, schema configuration, authentication settings and current sync status.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique id or name of Personalization Point to retrieve |

```sql
CALL cdp.p13n_point_get (id_or_name => 'home_page_experience');
```

**Result**

One row. No source shows a real response. These columns are the request attributes from the [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json), and the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) says the call returns the complete point. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Point id. Only the test mock shows this field. |
| `name` | `name` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace_name` | `dataSpaceName` | VARCHAR | API name of the data space. |
| `profile_data_graph_name` | `profileDataGraphName` | VARCHAR | Profile data graph the point targets. |
| `source` | `source` | VARCHAR | `BlockBuilder`, `ExperienceBuilder`, `FlowBuilder` or `PersonalizationApp`. |
| `is_authentication_required` | `isAuthenticationRequired` | BOOLEAN | Whether API calls require user authentication. |
| `schema_name` | `schemaName` | VARCHAR | Custom schema, if any. |
| `schema_enum` | `schemaEnum` | VARCHAR | Standard schema, if any. |
| `max_items_count` | `maxItemsCount` | INTEGER | Maximum number of items. |
| `decisions` | `decisions` | JSON | Array of [PersonalizationDecision](#personalizationdecision). |
| `status` | `status` | VARCHAR | Current sync status. Only the test mock shows this name, with `Active`. The [Point DMO](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationpointdmo-dmo.md) lists `Processing`, `Active`, `Error` and `Deleting`. |

**Notes:** No source has a list call for points. The docs describe a [`ssot__PersonalizationPoint__dlm`](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationpointdmo-dmo.md) DMO with `Name` and `PersonalizationPointStatus`, which a `SELECT` over the connection could read, but they don't say it holds every point created here.

## p13n_point_update

`PUT /personalization/personalization-points/{idOrName}` · tool `d360_p13n_point_update` · evidence S · changes org state

Replaces a point. It's a full `PUT`, so send the complete object with all required fields, including the unchanged `name`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique id or name of Personalization Point to update |
| `name` | `name` | body | string | yes | API name. It can't change after creation, but the payload example still sends it. |
| `label` | `label` | body | string | yes | - |
| `description` | `description` | body | string |  | - |
| `dataspace_name` | `dataSpaceName` | body | string | yes | API name of the data space. |
| `profile_data_graph_name` | `profileDataGraphName` | body | string | yes | Profile data graph the point targets. It must exist. |
| `source` | `source` | body | enum(BlockBuilder, ExperienceBuilder, FlowBuilder, PersonalizationApp) | yes | Where the point is defined: Email Builder blocks, Digital Experiences, Flow decisions or the Personalization app. |
| `is_authentication_required` | `isAuthenticationRequired` | body | boolean | yes | Whether API calls require user authentication. |
| `schema_name` | `schemaName` | body | string |  | A custom schema. Use `schema_enum` for a standard one. |
| `schema_enum` | `schemaEnum` | body | enum(DecisionDefined, ExperienceVariation, FlowPath) |  | A standard schema, in place of `schema_name`. |
| `max_items_count` | `maxItemsCount` | body | integer |  | The maximum number of items for this point. |
| `decisions` | `decisions` | body | array of [PersonalizationDecision](#personalizationdecision) | yes | Prioritized rules with criteria and attribute values. |

```sql
CALL cdp.p13n_point_update (
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
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) says changes take effect immediately for runtime execution, while the [Point DMO](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationpointdmo-dmo.md) describes a status for pipeline processing. No source connects the two, so read `p13n_point_get.status` afterwards. See [`p13n_point_create`](#p13n_point_create) for where the attributes come from and for the decision order conflict.

## p13n_point_delete

`DELETE /personalization/personalization-points/{idOrName}` · tool `d360_p13n_point_delete` · evidence S · changes org state

Deletes a point, which immediately stops personalization at that point in experience or flow execution. References from experiments or batch decisions break, and this can't be undone.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique id or name of Personalization Point to delete |

```sql
CALL cdp.p13n_point_delete (id_or_name => 'home_page_experience');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Experience configs that use the point can be found with [`p13n_experience_config_list`](#p13n_experience_config_list) and `personalization_point_name_or_id`, once per connector. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/PersonalizationTools.java) drops the HTTP response and returns its own `status` JSON, so that shape isn't the API's.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### PersonalizationAttribute

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | API name of the attribute. |
| `label` | `label` | string |  | - |
| `default_value` | `defaultValue` | string |  | Optional default value. |

### PersonalizationAttributeValue

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attribute_name` | `attributeName` | string |  | Name of an attribute in the schema. |
| `value` | `value` | string |  | - |

### PersonalizationContentObject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | API name of the content object. |
| `field_names` | `fieldNames` | array of string |  | DMO field API names. |

### PersonalizationDataProvider

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | enum(PersonalizationPoint) |  | The kind of data provider, which also describes how the data is provided. |
| `reference_type` | `referenceType` | enum(ApiName) |  | Kind of identifier in `value`. |
| `value` | `value` | string |  | Identifier of the provider. With `ApiName`, the provider's API name. |
| `dataspace_reference_type` | `dataSpaceReferenceType` | enum(ApiName) |  | Kind of identifier in `dataspace_value`. |
| `dataspace_value` | `dataSpaceValue` | string |  | Identifier of the data space. Optional, to override the default. |
| `group_by_type` | `groupByType` | enum(DataGraph) |  | If requests to this provider should be grouped, the type of the grouping value. |
| `group_by_reference_type` | `groupByReferenceType` | enum(ApiName) |  | Kind of identifier in `group_by_value`. |
| `group_by_value` | `groupByValue` | string |  | Identifier of the grouping value. Optional, to override the default. |

### PersonalizationDecision

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | - |
| `label` | `label` | string |  | - |
| `description` | `description` | string |  | - |
| `criteria` | `criteria` | string |  | Filter rule as a JSON string, such as `{"type":"Criteria","operator":"AND","filters":[]}`. The example shape is the only documentation. |
| `attribute_values` | `attributeValues` | array of [PersonalizationAttributeValue](#personalizationattributevalue) |  | Values for the schema's attributes. |
| `personalizer_name` | `personalizerName` | string |  | The personalizer that generates the response for this decision. |
| `state` | `state` | string |  | The examples use `Live`. The [Decision DMO](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-personalizationdecisiondmo-dmo.md) lists `Draft` and `LIVE`. |

### PersonalizationDecisionContext

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `individual_id` | `individualId` | string |  | The individual id associated with a profile. |
| `anchor_id` | `anchorId` | string |  | The anchor id used by the personalizer. |

### PersonalizationDecisionRequestBody

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `p` | `p` | [PersonalizationDecisionRequestItems](#personalizationdecisionrequestitems) |  | Decision, cohort and experiment ids for the preview. |
| `c` | `c` | [PersonalizationDecisionContext](#personalizationdecisioncontext) |  | Individual and anchor ids for the preview. |

### PersonalizationDecisionRequestItems

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `decision_id` | `decisionId` | string |  | - |
| `cohort_id` | `cohortId` | string |  | The experiment cohort id. |
| `experiment_id` | `experimentId` | string |  | - |

### PersonalizationExperienceConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Unique name of the config. |
| `label` | `label` | string |  | - |
| `description` | `description` | string |  | - |
| `data_provider` | `dataProvider` | [PersonalizationDataProvider](#personalizationdataprovider) |  | What is supplying the data for this experience. |
| `source_matchers` | `sourceMatchers` | array of [PersonalizationSourceMatcher](#personalizationsourcematcher) |  | How to find where this personalization occurs. For web, which pages. |
| `transformation_config` | `transformationConfig` | [PersonalizationTransformationConfig](#personalizationtransformationconfig) |  | How the provider's data is transformed and when. |
| `is_enabled` | `isEnabled` | boolean |  | Whether this configuration is enabled. |
| `display_url` | `displayUrl` | string |  | When editing this configuration on the website, which page to display it on if not the current page. |

### PersonalizationRelatedContentObject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `content_object_name` | `contentObjectName` | string |  | API name of the related content object. |
| `field_names` | `fieldNames` | array of string |  | DMO field API names. |
| `related_content_objects` | `relatedContentObjects` | array of [PersonalizationRelatedContentObject](#personalizationrelatedcontentobject) |  | Nested related content objects. |

### PersonalizationSourceMatcher

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | enum(PageType, PageUrlMatcher, ContentZone) |  | How to match the source. |
| `value` | `value` | string |  | For `PageType`, a page type from the Sitemap. For `PageUrlMatcher`, a page URL, which supports wildcards. The example passes a zone name for `ContentZone`. |

### PersonalizationSubstitution

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Shown in a UI when configuring this variable. |
| `description` | `description` | string |  | Shown in a UI when configuring this variable. |
| `config_type` | `configType` | enum(SchemaPath, Static) |  | `SchemaPath` takes data from the personalization point, `Static` is a hardcoded value. |
| `default_value` | `defaultValue` | string |  | Used if the experience config doesn't override the value. |
| `overridable` | `overridable` | boolean |  | Whether an experience can override the default. |
| `required` | `required` | boolean |  | Whether a value, default or from the experience, must be provided. |

### PersonalizationTransformation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `transformer_name` | `transformerName` | string |  | Name of the transformer to use. |
| `substitutions` | `substitutions` | map to any |  | Keys are substitution variables defined in the transformer, values are the values to use. |

### PersonalizationTransformationConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `render_if_empty` | `renderIfEmpty` | boolean |  | Whether to render the content if it couldn't be transformed. Not rendering is the default. |
| `when` | `when` | enum(Immediately, ExitIntent, ElementClick, ScrollPercent) |  | When the transformation occurs relative to its target being available. |
| `when_values` | `whenValues` | [PersonalizationWhenValues](#personalizationwhenvalues) |  | Extra data that `ElementClick` and `ScrollPercent` need. |
| `method` | `method` | enum(ReplaceContentZoneContent, ReplaceElementContent, AddAfterElement, AddBeforeElement, AddOverlay, ContentZoneHandler) |  | How the transformed content interacts with the config's target. |
| `engagement_destination` | `engagementDestination` | string |  | Maps to a destination entry in the Engagement config, which determines the event attributes needed to land the data in the target engagement DMO. |
| `transformations` | `transformations` | array of [PersonalizationTransformation](#personalizationtransformation) |  | How the provider's response is transformed into content. |

### PersonalizationTransformer

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | - |
| `label` | `label` | string |  | - |
| `description` | `description` | string |  | - |
| `data_connectors` | `dataConnectors` | array of string |  | Websites or mobile apps this transformer belongs to: id, name or appSourceId of a Streaming App data connector. |
| `channel` | `channel` | enum(MobileApp, WebApp) |  | Whether the transformer is for a website or a mobile app. |
| `substitution_definitions` | `substitutionDefinitions` | map to [PersonalizationSubstitution](#personalizationsubstitution) |  | The key is the variable name. |
| `schema_reference` | `schemaReference` | string |  | Name of the schema the substitution definitions were created from. |
| `dataspace` | `dataSpace` | string |  | Name of the data space the transformer belongs to. |
| `is_enabled` | `isEnabled` | boolean |  | Whether the transformer is enabled when delivered to the app or website. |
| `transformer_type` | `transformerType` | enum(Handlebars, HtmlElementModifier, AgentScript, Component) |  | Tells the SDK how the transformer works and what code renders it. |
| `thumbnail_image` | `thumbnailImage` | string |  | Thumbnail image, as a URL or base64-encoded data. |
| `transformer_type_details` | `transformerTypeDetails` | [PersonalizationTransformerDetails](#personalizationtransformerdetails) |  | Data specific to `transformer_type`. |

### PersonalizationTransformerDetails

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `html` | `html` | string |  | Handlebars HTML template. |
| `script` | `script` | string |  | Handlebars script template. |
| `component_name` | `componentName` | string |  | Component class in the app that does the rendering. For now that means mobile. |
| `disable_auto_injection_of_engagement_attributes` | `disableAutoInjectionOfEngagementAttributes` | boolean |  | If true, the HTML must provide engagement attributes through substitution values. Auto-injection is the default. |

### PersonalizationWhenValues

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `value` | `value` | string |  | CSS selector for `ElementClick`, or a percentage for `ScrollPercent`. |
