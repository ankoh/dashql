# Data Governance

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

This family labels data and controls who can read it. [Governance runs on tags rather than per-user permissions](https://trailhead.salesforce.com/content/learn/modules/data-cloud-governance-quick-look/get-to-know-data-cloud-governance): you label objects and fields, and policies act on the labels.

- **Tags and assignments:** a tag taxonomy holds tags up to two levels deep. A tag assignment puts a tag on an object or field.
- **Classifications and taxonomies:** classifications group tags, in their own taxonomies. A classification assignment links a classification to a tag, not to data.
- **Detection:** detection instructions tell an LLM what a tag means. Generating suggestions starts a job per object, and you approve or reject the results.
- **Access policies and rules:** a policy holds rules that permit, forbid or mask.
- **Object access grants:** these give a permission set access to an object in a data space.

Dependencies set the order: create a taxonomy before its tags, a parent tag before its children, and tags before anything that references them.

Gotchas:

- Names are dotted paths, `<Taxonomy>.<Level1>[.<Level2>]`. A taxonomy's `fully_qualified_name` is just its name.
- List `limit` must be 5 to 200, so smaller values return 400.
- Bulk calls can return success with failed items. Check `has_errors` and each `results[].statusCode`.
- Most deletes return 202, and tags can sit in state `Deleting`.

```sql
CALL cdp.tag_taxonomy_create (name => 'Compliance_Tags', label => 'Compliance Tags');
CALL cdp.tag_create (fully_qualified_name => 'Compliance_Tags.PII', label => 'PII');
CALL cdp.tag_create (fully_qualified_name => 'Compliance_Tags.PII.Email', label => 'Email Address');
CALL cdp.tag_assignment_create (tag_fully_qualified_name => 'Compliance_Tags.PII.Email', object_name => 'Individual_DLO__dll', field_name => 'Email');
CALL cdp.tags_propagate (object_names => ['Individual_DLO__dll']);
```

**Functions:** [`access_policy_delete`](#access_policy_delete), [`classification_assignment_delete`](#classification_assignment_delete), [`classification_taxonomy_delete`](#classification_taxonomy_delete), [`classification_delete`](#classification_delete), [`object_access_grant_delete`](#object_access_grant_delete), [`tag_assignment_delete`](#tag_assignment_delete), [`tag_taxonomy_delete`](#tag_taxonomy_delete), [`tag_delete`](#tag_delete), [`tag_detection_instruction_deactivate`](#tag_detection_instruction_deactivate), [`access_policy_list`](#access_policy_list), [`access_policy_get`](#access_policy_get), [`access_policy_rule_get`](#access_policy_rule_get), [`auto_tagging_job_list`](#auto_tagging_job_list), [`auto_tagging_job_get`](#auto_tagging_job_get), [`classification_assignment_list`](#classification_assignment_list), [`classification_assignment_get`](#classification_assignment_get), [`classification_taxonomy_list`](#classification_taxonomy_list), [`classification_taxonomy_get`](#classification_taxonomy_get), [`classification_list`](#classification_list), [`classification_get`](#classification_get), [`classification_assignments_classification_list`](#classification_assignments_classification_list), [`object_access_grant_list`](#object_access_grant_list), [`object_access_grant_get`](#object_access_grant_get), [`tag_assignment_list`](#tag_assignment_list), [`tag_assignment_get`](#tag_assignment_get), [`tag_suggestion_list`](#tag_suggestion_list), [`tag_suggestion_get`](#tag_suggestion_get), [`tag_taxonomy_list`](#tag_taxonomy_list), [`tag_taxonomy_get`](#tag_taxonomy_get), [`tags_active_detection_instruction_list`](#tags_active_detection_instruction_list), [`tag_list`](#tag_list), [`tag_get`](#tag_get), [`tag_assignments_tag_list`](#tag_assignments_tag_list), [`tag_detection_instruction_get`](#tag_detection_instruction_get), [`access_policy_update`](#access_policy_update), [`classification_taxonomy_update`](#classification_taxonomy_update), [`classification_update`](#classification_update), [`tag_taxonomy_update`](#tag_taxonomy_update), [`tag_update`](#tag_update), [`access_policy_create`](#access_policy_create), [`classification_assignment_create`](#classification_assignment_create), [`classification_assignment_bulk_create`](#classification_assignment_bulk_create), [`classification_assignment_bulk_delete`](#classification_assignment_bulk_delete), [`classification_taxonomy_create`](#classification_taxonomy_create), [`classification_taxonomy_bulk_create`](#classification_taxonomy_bulk_create), [`classification_taxonomy_bulk_delete`](#classification_taxonomy_bulk_delete), [`classification_taxonomy_bulk_update`](#classification_taxonomy_bulk_update), [`classification_create`](#classification_create), [`classification_bulk_create`](#classification_bulk_create), [`classification_bulk_delete`](#classification_bulk_delete), [`classification_bulk_update`](#classification_bulk_update), [`object_access_grant_create`](#object_access_grant_create), [`object_access_grant_bulk_create`](#object_access_grant_bulk_create), [`object_access_grant_bulk_delete`](#object_access_grant_bulk_delete), [`tag_assignment_create`](#tag_assignment_create), [`tag_assignment_bulk_create`](#tag_assignment_bulk_create), [`tag_assignment_bulk_delete`](#tag_assignment_bulk_delete), [`tag_suggestions_approve`](#tag_suggestions_approve), [`tag_suggestions_generate`](#tag_suggestions_generate), [`tag_suggestions_reject`](#tag_suggestions_reject), [`tag_taxonomy_create`](#tag_taxonomy_create), [`tag_detection_instruction_bulk_create`](#tag_detection_instruction_bulk_create), [`tag_taxonomy_bulk_create`](#tag_taxonomy_bulk_create), [`tag_taxonomy_bulk_delete`](#tag_taxonomy_bulk_delete), [`tag_taxonomy_bulk_update`](#tag_taxonomy_bulk_update), [`tag_create`](#tag_create), [`tag_detection_instruction_create`](#tag_detection_instruction_create), [`tag_bulk_create`](#tag_bulk_create), [`tag_bulk_delete`](#tag_bulk_delete), [`tag_bulk_update`](#tag_bulk_update), [`tags_propagate`](#tags_propagate), [`access_policy_rule_replace`](#access_policy_rule_replace)

## access_policy_delete

`DELETE /ssot/data-governance/access-policies/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies~1%7Bname%7D/delete) · evidence O · changes org state

Permanently deletes an access policy and cascades the delete to its rules. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Developer name of the access policy. |

```sql
CALL cdp.access_policy_delete (name => 'RestrictSensitiveFields');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

## classification_assignment_delete

`DELETE /ssot/data-governance/classification-assignments/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-assignments~1%7Bid%7D/delete) · evidence O · changes org state

Deletes a data governance classification assignment by ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the classification assignment. |

```sql
CALL cdp.classification_assignment_delete (id => '9aa000000000050');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

## classification_taxonomy_delete

`DELETE /ssot/data-governance/classification-taxonomies/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies~1%7Bname%7D/delete) · evidence O · changes org state

Deletes a classification taxonomy. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | API name or developer name of the classification taxonomy. |

```sql
CALL cdp.classification_taxonomy_delete (name => 'Data_Residency_Classifications');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

**Done when:** `classification_taxonomy_get` returns 404. Inferred from the 202 response and the `Deleting` state, not documented.

**Notes:** Returns 412 `REFERENTIAL_INTEGRITY_VIOLATION` if the taxonomy has external dependencies or child classifications, so delete those first. System taxonomies can't be deleted. Returns 202. The spec has a `Deleting` state and the errors "Entity is already being deleted" and "Cannot update entity in Deleting state", so deletion looks like it finishes in the background. No source documents a wait.

## classification_delete

`DELETE /ssot/data-governance/classifications/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1%7BfullyQualifiedName%7D/delete) · evidence O · changes org state

Deletes a classification and cascades the deletion to any child classifications and assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the classification. |

```sql
CALL cdp.classification_delete (fully_qualified_name => 'Compliance_Classifications.Sensitive');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

**Done when:** `classification_get` returns 404. Inferred from the 202 response and the `Deleting` state, not documented.

**Notes:** The description promises a cascade to children and assignments, but the spec also lists a 412 "has external dependencies or children classifications". Sources conflict. System classifications can't be deleted. Returns 202. The spec has a `Deleting` state and the errors "Entity is already being deleted" and "Cannot update entity in Deleting state", so deletion looks like it finishes in the background. No source documents a wait.

## object_access_grant_delete

`DELETE /ssot/data-governance/object-access-grants/{objectApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1object-access-grants~1%7BobjectApiName%7D/delete) · evidence O · changes org state

Deletes a single object access grant. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_api_name` | `objectApiName` | path | string | yes | API name of the Data Cloud object. |
| `dataspace_name` | `dataSpaceName` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v67.0. |
| `permission_set_name` | `permissionSetName` | query | string |  | Developer name of the permission set. Since v67.0. |

```sql
CALL cdp.object_access_grant_delete (object_api_name => 'Account__dlm', dataspace_name => 'default', permission_set_name => 'DC_Analyst_PermSet');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** A grant is identified by object, data space and permission set, as the 404 message shows. The spec marks `permission_set_name` optional, and doesn't say which grant is meant without it when several permission sets grant the object. Pass all three.

## tag_assignment_delete

`DELETE /ssot/data-governance/tag-assignments/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-assignments~1%7Bid%7D/delete) · evidence O · changes org state

Deletes a data governance tag assignment by ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the tag assignment. |

```sql
CALL cdp.tag_assignment_delete (id => '9aa000000000001');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

## tag_taxonomy_delete

`DELETE /ssot/data-governance/tag-taxonomies/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1%7BfullyQualifiedName%7D/delete) · evidence O · changes org state

Deletes a tag taxonomy and all child tags. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully qualified API name of the tag taxonomy. A taxonomy has one segment, so this is its developer name, such as `Compliance_Tags`. |

```sql
CALL cdp.tag_taxonomy_delete (fully_qualified_name => 'Marketing_Tags');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

**Done when:** `tag_taxonomy_get` returns 404. Inferred from the 202 response and the `Deleting` state, not documented.

**Notes:** The description promises deleting all child tags, but the spec also lists a 412 "has external dependencies or children tags". Sources conflict. System taxonomies can't be deleted. Returns 202. The spec has a `Deleting` state and the errors "Entity is already being deleted" and "Cannot update entity in Deleting state", so deletion looks like it finishes in the background. No source documents a wait.

## tag_delete

`DELETE /ssot/data-governance/tags/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D/delete) · evidence O · changes org state

Deletes a tag and cascades the deletion to any child tags and assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully qualified API name of the tag. |

```sql
CALL cdp.tag_delete (fully_qualified_name => 'Compliance_Tags.PII.Phone');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

**Done when:** `tag_get` returns 404. Inferred from the 202 response and the `Deleting` state, not documented.

**Notes:** The description promises a cascade to children and assignments, but the spec also lists a 412 "has external dependencies or children tags". Sources conflict. System tags can't be deleted. No source says what happens to policies that test the tag. Returns 202. The spec has a `Deleting` state and the errors "Entity is already being deleted" and "Cannot update entity in Deleting state", so deletion looks like it finishes in the background. No source documents a wait.

## tag_detection_instruction_deactivate

`DELETE /ssot/data-governance/tags/{fullyQualifiedName}/detection-instructions/active` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D~1detection-instructions~1active/delete) · evidence O · changes org state

Deactivates the currently active detection instruction for a tag. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the tag (dotted path). |

```sql
CALL cdp.tag_detection_instruction_deactivate (fully_qualified_name => 'Compliance_Tags.PII.CreditCard');
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

**Notes:** This deactivates the instruction and doesn't delete the tag. Returns 202.

## access_policy_list

`GET /ssot/data-governance/access-policies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies/get) · evidence O · read-only

Returns a paginated list of builder-compatible access policies. To include system or legacy policies that aren't builder-compatible, set `include_incompatible` to `true`. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `include_incompatible` | `includeIncompatible` | query | boolean |  | Indicates whether to include policies that aren't builder-compatible (`true`) or not (`false`). If unspecified, the default value is `false`. Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of access policies to return. Values are `5` through `200`. If unspecified, the default value is `25`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `search_string` | `searchString` | query | string |  | Case-insensitive substring to match against the policy name or label. Since v67.0. |

```sql
CALL cdp.access_policy_list (search_string => 'mask', include_incompatible => true);
```

**Result**

One row per item of `/records` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `AccessPolicyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `builder_compatible` | `builderCompatible` | BOOLEAN | Indicates whether the policy was authored to be renderable in the access policy builder (`true`) or not (`false`). Since v67.0. |
| `builder_validated` | `builderValidated` | BOOLEAN | Indicates whether the access policy validator has run for the policy (`true`) or not (`false`). Read-only; the server derives this value on save. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the policy. Since v67.0. |
| `rules` | `rules` | JSON (array of AccessPolicyRuleRepresentation) | Rules contained in the policy. The access policy builder restricts a policy to one rule; multi-rule policies have `builder_compatible` set to `false`. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** An org without the feature can return 404, although the spec declares only 400. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) records this from a live org, and [config-snapshot-data360](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) saw the same (community, one org).

## access_policy_get

`GET /ssot/data-governance/access-policies/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies~1%7Bname%7D/get) · evidence O · read-only

Returns a single access policy and its rules by developer name. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Developer name of the access policy. |

```sql
CALL cdp.access_policy_get (name => 'RestrictSensitiveFields');
```

**Result**

One row. Schema `AccessPolicyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `builder_compatible` | `builderCompatible` | BOOLEAN | Indicates whether the policy was authored to be renderable in the access policy builder (`true`) or not (`false`). Since v67.0. |
| `builder_validated` | `builderValidated` | BOOLEAN | Indicates whether the access policy validator has run for the policy (`true`) or not (`false`). Read-only; the server derives this value on save. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the policy. Since v67.0. |
| `rules` | `rules` | JSON (array of AccessPolicyRuleRepresentation) | Rules contained in the policy. The access policy builder restricts a policy to one rule; multi-rule policies have `builder_compatible` set to `false`. Since v67.0. |

**Notes:** The spec lists `MULTIPLE_RULES_NOT_ALLOWED` and `NAME_MISMATCH` as 400s on this read. Those look like errors of `access_policy_rule_replace` filed under the wrong verb.

## access_policy_rule_get

`GET /ssot/data-governance/access-policies/{name}/rules/{ruleName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies~1%7Bname%7D~1rules~1%7BruleName%7D/get) · evidence O · read-only

Returns the details of a specific rule within an access policy. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Developer name of the parent access policy. |
| `rule_name` | `ruleName` | path | string | yes | Developer name of the rule. |

```sql
CALL cdp.access_policy_rule_get (name => 'RestrictSensitiveFields', rule_name => 'Mask_SSN');
```

**Result**

One row. Schema `AccessPolicyRuleRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `action` | `action` | JSON | Actions the rule applies to, such as `Read`. Since v67.0. |
| `category` | `category` | VARCHAR | MDAPI rule category, which determines the validator that dispatches. Since v67.0. |
| `effect` | `effect` | VARCHAR | Effect of the rule. Since v67.0. |
| `id` | `id` | VARCHAR | 18-character record ID of the underlying PolicyRuleDefinition. Since v67.0. |
| `label` | `label` | VARCHAR | Display label for the rule. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the rule (PolicyRuleDefinition fullName). Since v67.0. |
| `principal_authentication_level` | `principalAuthenticationLevel` | VARCHAR | Required principal authentication level. Since v67.0. |
| `principal_scope_type` | `principalScopeType` | VARCHAR | Principal scope type. Since v67.0. |
| `resource_domains` | `resourceDomains` | JSON | DMOs or objects the rule scopes to. Required for record-scope (RLS) rules; typically empty or absent for OLS or FLS. Since v67.0. |
| `resource_scope_type` | `resourceScopeType` | VARCHAR | Resource scope type. Since v67.0. |
| `resource_transform` | `resourceTransform` | VARCHAR | For Transform or FLS rules, the transform applied to the field before the principal sees it. Since v67.0. |
| `resource_transform_arguments` | `resourceTransformArguments` | JSON (array of ResourceTransformArgumentRepresentation) | Static argument list for the resource transform, such as the `2` for `FIRST_N_CHARS_RESOURCE_TRANSFORM`. Since v67.0. |
| `rule_consumer` | `ruleConsumer` | VARCHAR | Consumer of the rule's enforcement. Since v67.0. |
| `transform_precedence` | `transformPrecedence` | BIGINT | Tiebreaker when multiple Transform rules apply to the same field. The lower value wins. Emitted only on Transform-effect rules. Since v67.0. |
| `unless` | `unless` | JSON (ConditionGroupRepresentation) | Condition group that, when met, exempts the rule from applying. Since v67.0. |
| `when` | `when` | JSON (ConditionGroupRepresentation) | Condition group that must be met for the rule to apply. Since v67.0. |

## auto_tagging_job_list

`GET /ssot/data-governance/auto-tagging-jobs` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1auto-tagging-jobs/get) · evidence O · read-only

Returns a paginated list of data governance auto-tagging jobs, optionally filtered by object or status. Auto-tagging jobs are created by the generate tag suggestions action. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of auto-tagging jobs to return. Values are from `5` through `200`. The default value is `25` if unspecified. Since v67.0. |
| `object_name` | `objectName` | query | string |  | API name of the object to filter jobs by. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `status` | `status` | query | string |  | Status to filter jobs by. Values are `InProgress`, `Success`, or `Fail`. Since v67.0. |

```sql
CALL cdp.auto_tagging_job_list ();
```

**Result**

One row per item of `/jobs` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `AutoTaggingJobRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the job was created. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the job. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the job status was last updated. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Target object API name. Since v67.0. |
| `status` | `status` | VARCHAR | Status of the job. Since v67.0. |

**Paging:** `next_page_url`.

## auto_tagging_job_get

`GET /ssot/data-governance/auto-tagging-jobs/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1auto-tagging-jobs~1%7Bid%7D/get) · evidence O · read-only

Returns a single data governance auto-tagging job by ID, reporting its progress and status. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the auto-tagging job. Since v67.0. |

```sql
CALL cdp.auto_tagging_job_get (id => '...');
```

**Result**

One row. Schema `AutoTaggingJobRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the job was created. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the job. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the job status was last updated. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Target object API name. Since v67.0. |
| `status` | `status` | VARCHAR | Status of the job. Since v67.0. |

**Notes:** The `id` is a `job_id` from `tag_suggestions_generate`.

## classification_assignment_list

`GET /ssot/data-governance/classification-assignments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-assignments/get) · evidence O · read-only

Returns a paginated list of data governance classification assignments, optionally filtered by tag or classification. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | query | string |  | Fully-qualified API name of the classification to filter assignments by. Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of classification assignments to return. Values are from `5` through `200`. The default value is `25` if unspecified. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | query | string |  | Fully-qualified API name of the tag to filter assignments by. Since v67.0. |

```sql
CALL cdp.classification_assignment_list ();
```

**Result**

One row per item of `/classificationAssignments` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `ClassificationAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classification_fully_qualified_label` | `classificationFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the classification (dotted path of ancestor labels). Since v67.0. |
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | VARCHAR | Fully-qualified API name of the source classification. Since v67.0. |
| `classification_id` | `classificationId` | VARCHAR | ID of the source classification. Since v67.0. |
| `classification_label` | `classificationLabel` | VARCHAR | Leaf display label of the classification. Since v67.0. |
| `classification_name` | `classificationName` | VARCHAR | Leaf developer name of the source classification. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the classification assignment. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the target tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the target tag. Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the target tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the target tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the target tag. Since v67.0. |

**Paging:** `next_page_url`.

## classification_assignment_get

`GET /ssot/data-governance/classification-assignments/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-assignments~1%7Bid%7D/get) · evidence O · read-only

Returns a single data governance classification assignment by ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the classification assignment. |

```sql
CALL cdp.classification_assignment_get (id => '9aa000000000050');
```

**Result**

One row. Schema `ClassificationAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classification_fully_qualified_label` | `classificationFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the classification (dotted path of ancestor labels). Since v67.0. |
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | VARCHAR | Fully-qualified API name of the source classification. Since v67.0. |
| `classification_id` | `classificationId` | VARCHAR | ID of the source classification. Since v67.0. |
| `classification_label` | `classificationLabel` | VARCHAR | Leaf display label of the classification. Since v67.0. |
| `classification_name` | `classificationName` | VARCHAR | Leaf developer name of the source classification. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the classification assignment. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the target tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the target tag. Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the target tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the target tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the target tag. Since v67.0. |

## classification_taxonomy_list

`GET /ssot/data-governance/classification-taxonomies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies/get) · evidence O · read-only

Returns a paginated list of classification taxonomies. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of classification taxonomies to return. Must be between `5` and `200`. If unspecified, the default value is `25`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, the default value is `ASC` ordered by developer name. Since v67.0. |
| `search_string` | `searchString` | query | string |  | Search keyword to match against the developer name or label. Since v67.0. |

```sql
CALL cdp.classification_taxonomy_list ();
```

**Result**

One row per item of `/taxonomies` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The option text says `order_by` takes `ASC` or `DESC`, but the spec's error example says "Invalid order_by field. Valid fields: Label, DeveloperName." Sources conflict, so test before relying on it.

## classification_taxonomy_get

`GET /ssot/data-governance/classification-taxonomies/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies~1%7Bname%7D/get) · evidence O · read-only

Returns a classification taxonomy by its API name. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | API name or developer name of the classification taxonomy. |

```sql
CALL cdp.classification_taxonomy_get (name => 'Compliance_Classifications');
```

**Result**

One row. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

## classification_list

`GET /ssot/data-governance/classifications` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications/get) · evidence O · read-only

Returns a paginated list of classifications across all classification taxonomies. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of classifications to return from `5` through `200`. If unspecified, the default number of rows is `25`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified,the default value is `ASC` ordered by developer name. Since v67.0. |
| `parent_classification_fully_qualified_name` | `parentClassificationFullyQualifiedName` | query | string |  | Fully-qualified API name of the parent classification. Scopes the list to direct children. Since v67.0. |
| `search_string` | `searchString` | query | string |  | Search keyword to match against the developer name or label. Since v67.0. |
| `taxonomy_name` | `taxonomyName` | query | string |  | Fully-qualified API name of the classification taxonomy (for example, `Compliance_Classifications`). Scopes the list to classifications under that taxonomy. Since v67.0. |

```sql
CALL cdp.classification_list ();
```

**Result**

One row per item of `/classifications` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `ClassificationRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the classification. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the classification was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the classification. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the classification in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the classification. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the classification. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the classification. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the classification was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the classification. Terminal segment only. Since v67.0. |
| `parent_classification` | `parentClassification` | JSON (ClassificationLookupRepresentation) | Parent classification reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the classification. Since v67.0. |
| `tags` | `tags` | JSON (array of TagLookupRepresentation) | Tags associated with the classification. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of classification. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the classification resource. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The option text says `order_by` takes `ASC` or `DESC`, but the spec's error example says "Invalid order_by field. Valid fields: Label, DeveloperName." Sources conflict, so test before relying on it. The option text says `offset` must be greater than zero, while other lists in this family only require non-negative. Omit it on the first page.

## classification_get

`GET /ssot/data-governance/classifications/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1%7BfullyQualifiedName%7D/get) · evidence O · read-only

Returns a classification by its fully-qualified API name. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the classification. |

```sql
CALL cdp.classification_get (fully_qualified_name => 'Compliance_Classifications.PII');
```

**Result**

One row. Schema `ClassificationRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the classification. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the classification was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the classification. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the classification in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the classification. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the classification. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the classification. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the classification was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the classification. Terminal segment only. Since v67.0. |
| `parent_classification` | `parentClassification` | JSON (ClassificationLookupRepresentation) | Parent classification reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the classification. Since v67.0. |
| `tags` | `tags` | JSON (array of TagLookupRepresentation) | Tags associated with the classification. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of classification. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the classification resource. Since v67.0. |

## classification_assignments_classification_list

`GET /ssot/data-governance/classifications/{fullyQualifiedName}/assignments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1%7BfullyQualifiedName%7D~1assignments/get) · evidence O · read-only

Returns a paginated list of assignments for a specific classification, including all linked tags. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the classification (dotted path). Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of classification assignments to return. Values are from `5` through `200`. The default value is `25` if unspecified. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |

```sql
CALL cdp.classification_assignments_classification_list (fully_qualified_name => 'Compliance_Classifications.PII');
```

**Result**

One row per item of `/classificationAssignments` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `ClassificationAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classification_fully_qualified_label` | `classificationFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the classification (dotted path of ancestor labels). Since v67.0. |
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | VARCHAR | Fully-qualified API name of the source classification. Since v67.0. |
| `classification_id` | `classificationId` | VARCHAR | ID of the source classification. Since v67.0. |
| `classification_label` | `classificationLabel` | VARCHAR | Leaf display label of the classification. Since v67.0. |
| `classification_name` | `classificationName` | VARCHAR | Leaf developer name of the source classification. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the classification assignment. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the target tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the target tag. Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the target tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the target tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the target tag. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** Returns the same kind of rows as `classification_assignment_list` with `classification_fully_qualified_name`.

## object_access_grant_list

`GET /ssot/data-governance/object-access-grants` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1object-access-grants/get) · evidence O · read-only

Returns a paginated list of object access grants, with optional filters. Providing only a permission set name returns all associated grants across data spaces and objects. Providing only a data space name returns all grants for objects within that data space across all permission sets. Providing only an object name returns all permission sets that grant access to that object. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | query | string |  | Developer name of the data space to filter grants by. Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of object access grants to return. Values are `5` through `200`. If unspecified, the default value is `25`. Since v67.0. |
| `object_api_name` | `objectApiName` | query | string |  | API name of the DMO, DLO, or CIO object to filter grants by. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `permission_set_name` | `permissionSetName` | query | string |  | Developer name of the permission set or permission set group to filter grants by. Since v67.0. |

```sql
CALL cdp.object_access_grant_list (permission_set_name => 'DC_Analyst_PermSet');
```

**Result**

One row per item of `/grants` in the response. Other response fields go to `_meta`: `count`, `currentPageUrl`, `limit`, `nextPageUrl`, `offset`, `previousPageUrl`, `totalSize`. Schema `DataGovernanceObjectAccessGrantRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the grant. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Timestamp when the grant was created. Since v67.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Name of the data space that the grant belongs to. Since v67.0. |
| `object_api_name` | `objectApiName` | VARCHAR | API name of the granted Data Cloud object. Since v67.0. |
| `permission_set_name` | `permissionSetName` | VARCHAR | Developer name of the permission set. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The description defines what each single filter returns, not what combinations do.

## object_access_grant_get

`GET /ssot/data-governance/object-access-grants/{objectApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1object-access-grants~1%7BobjectApiName%7D/get) · evidence O · read-only

Returns a single object access grant. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_api_name` | `objectApiName` | path | string | yes | API name of the Data Cloud object. |
| `dataspace_name` | `dataSpaceName` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v67.0. |
| `permission_set_name` | `permissionSetName` | query | string |  | Developer name of the permission set. Since v67.0. |

```sql
CALL cdp.object_access_grant_get (object_api_name => 'Account__dlm', dataspace_name => 'default', permission_set_name => 'DC_Analyst_PermSet');
```

**Result**

One row. Schema `DataGovernanceObjectAccessGrantRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the grant. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Timestamp when the grant was created. Since v67.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Name of the data space that the grant belongs to. Since v67.0. |
| `object_api_name` | `objectApiName` | VARCHAR | API name of the granted Data Cloud object. Since v67.0. |
| `permission_set_name` | `permissionSetName` | VARCHAR | Developer name of the permission set. Since v67.0. |

**Notes:** A grant is identified by object, data space and permission set, as the 404 message shows. The spec marks `permission_set_name` optional, and doesn't say which grant is meant without it when several permission sets grant the object. Pass all three.

## tag_assignment_list

`GET /ssot/data-governance/tag-assignments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-assignments/get) · evidence O · read-only

Returns a paginated list of data governance tag assignments for a given object, with optional field filtering. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `field_name` | `fieldName` | query | string |  | API name of the field to filter tag assignments by. Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of tag assignments to return. Values are from `5` through `200`. The default value is `25` if unspecified. Since v67.0. |
| `object_name` | `objectName` | query | string |  | API name of the object to filter tag assignments by. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | query | string |  | Fully-qualified API name of the tag to filter assignments by. Since v67.0. |

```sql
CALL cdp.tag_assignment_list (object_name => 'Individual_DLO__dll', field_name => 'Email');
```

**Result**

One row per item of `/tagAssignments` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TagAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `field_label` | `fieldLabel` | VARCHAR | Label of the field the tag is assigned to. Since v67.0. |
| `field_name` | `fieldName` | VARCHAR | Name of the field the tag is assigned to. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the tag assignment. Since v67.0. |
| `object_label` | `objectLabel` | VARCHAR | Label of the object the tag is assigned to. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Name of the object the tag is assigned to. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the assigned tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the assigned tag (dotted path). Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the assigned tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the assigned tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the assigned tag (terminal segment only). Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The spec describes this as a list "for a given object" but marks `object_name` optional, so an unfiltered call is undocumented. `field_name` without `object_name` returns 400. To list by tag alone, use `tag_assignments_tag_list`.

## tag_assignment_get

`GET /ssot/data-governance/tag-assignments/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-assignments~1%7Bid%7D/get) · evidence O · read-only

Returns a single data governance tag assignment by ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the tag assignment. |

```sql
CALL cdp.tag_assignment_get (id => '9aa000000000001');
```

**Result**

One row. Schema `TagAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `field_label` | `fieldLabel` | VARCHAR | Label of the field the tag is assigned to. Since v67.0. |
| `field_name` | `fieldName` | VARCHAR | Name of the field the tag is assigned to. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the tag assignment. Since v67.0. |
| `object_label` | `objectLabel` | VARCHAR | Label of the object the tag is assigned to. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Name of the object the tag is assigned to. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the assigned tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the assigned tag (dotted path). Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the assigned tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the assigned tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the assigned tag (terminal segment only). Since v67.0. |

## tag_suggestion_list

`GET /ssot/data-governance/tag-suggestions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-suggestions/get) · evidence O · read-only

Returns a paginated list of AI-generated data governance tag suggestions, optionally filtered by object, tag, or status. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of tag suggestions to return. The spec's error text says `5` through `200`. Since v67.0. |
| `object_name` | `objectName` | query | string |  | API name of the object to filter suggestions by. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `status` | `status` | query | string |  | Status to filter suggestions by. The response enum is `New`, `Approved`, `Rejected`, or `AutoRejected`. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | query | string |  | Fully-qualified API name of the tag to filter suggestions by. Since v67.0. |

```sql
CALL cdp.tag_suggestion_list (object_name => 'Individual_DLO__dll', status => 'New');
```

**Result**

One row per item of `/suggestions` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TagSuggestionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `assignment_id` | `assignmentId` | VARCHAR | ID of the tag assignment created when the suggestion was approved. Null if not yet approved. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the suggestion was generated. Since v67.0. |
| `field_name` | `fieldName` | VARCHAR | Target field API name. Null if the suggestion targets the object rather than a specific field. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the suggestion. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Target object API name. Since v67.0. |
| `processed_by` | `processedBy` | JSON (CdpUserRepresentation) | User who approved or rejected the suggestion. Null if not yet processed. Since v67.0. |
| `processed_date` | `processedDate` | TIMESTAMPTZ | Date the suggestion was approved or rejected. Null if the suggestion is new. Since v67.0. |
| `score` | `score` | DOUBLE | LLM confidence score. Since v67.0. |
| `status` | `status` | VARCHAR | Status of the suggestion. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the suggested tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the suggested tag (dotted path). Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the suggested tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the suggested tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the suggested tag (terminal segment only). Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The spec's response enum for `status` is `New`, `Approved`, `Rejected` and `AutoRejected`. It doesn't say what causes `AutoRejected`.

## tag_suggestion_get

`GET /ssot/data-governance/tag-suggestions/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-suggestions~1%7Bid%7D/get) · evidence O · read-only

Returns a single AI-generated tag suggestion by ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the tag suggestion. Since v67.0. |

```sql
CALL cdp.tag_suggestion_get (id => '1dg000000000001');
```

**Result**

One row. Schema `TagSuggestionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `assignment_id` | `assignmentId` | VARCHAR | ID of the tag assignment created when the suggestion was approved. Null if not yet approved. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the suggestion was generated. Since v67.0. |
| `field_name` | `fieldName` | VARCHAR | Target field API name. Null if the suggestion targets the object rather than a specific field. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the suggestion. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Target object API name. Since v67.0. |
| `processed_by` | `processedBy` | JSON (CdpUserRepresentation) | User who approved or rejected the suggestion. Null if not yet processed. Since v67.0. |
| `processed_date` | `processedDate` | TIMESTAMPTZ | Date the suggestion was approved or rejected. Null if the suggestion is new. Since v67.0. |
| `score` | `score` | DOUBLE | LLM confidence score. Since v67.0. |
| `status` | `status` | VARCHAR | Status of the suggestion. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the suggested tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the suggested tag (dotted path). Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the suggested tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the suggested tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the suggested tag (terminal segment only). Since v67.0. |

## tag_taxonomy_list

`GET /ssot/data-governance/tag-taxonomies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies/get) · evidence O · read-only

Returns a paginated list of tag taxonomies. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of tag taxonomies to return. Must be between `5` and `200`. If unspecified, the default value is `25`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, the default value is `ASC` ordered by developer name. Since v67.0. |
| `search_string` | `searchString` | query | string |  | Search keyword to match against the developer name or label. Since v67.0. |

```sql
CALL cdp.tag_taxonomy_list ();
```

**Result**

One row per item of `/taxonomies` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The option text says `order_by` takes `ASC` or `DESC`, but the spec's error example says "Invalid order_by field. Valid fields: Label, DeveloperName." Sources conflict, so test before relying on it.

## tag_taxonomy_get

`GET /ssot/data-governance/tag-taxonomies/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1%7BfullyQualifiedName%7D/get) · evidence O · read-only

Returns a tag taxonomy by its fully qualified API name. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully qualified API name of the tag taxonomy. A taxonomy has one segment, so this is its developer name, such as `Compliance_Tags`. |

```sql
CALL cdp.tag_taxonomy_get (fully_qualified_name => 'Compliance_Tags');
```

**Result**

One row. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

## tags_active_detection_instruction_list

`GET /ssot/data-governance/tag-taxonomies/{fullyQualifiedName}/tags-with-active-detection-instructions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1%7BfullyQualifiedName%7D~1tags-with-active-detection-instructions/get) · evidence O · read-only

Returns a paginated list of tags in a taxonomy along with their active detection instruction, if any. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the tag taxonomy. Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of tags to return. Values are from `5` through `200`. The default value is `25` if unspecified. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |

```sql
CALL cdp.tags_active_detection_instruction_list (fully_qualified_name => 'Compliance_Tags');
```

**Result**

One row per item of `/tagsWithActiveDetectionInstructions` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TagWithActiveDetectionInstructionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `active_detection_instruction` | `activeDetectionInstruction` | JSON (TagDetectionInstructionRepresentation) | Currently active detection instruction for the tag. Null if the tag has no active instruction. Since v67.0. |
| `tag` | `tag` | JSON (TagLookupRepresentation) | Tag the detection instruction applies to. Since v67.0. |

**Paging:** `next_page_url`.

## tag_list

`GET /ssot/data-governance/tags` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags/get) · evidence O · read-only

Returns a paginated list of tags across all tag taxonomies. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of tags to return from `5` through `200`. If unspecified, the default number of rows is `25`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, the default value is `ASC` ordered by developer name. Since v67.0. |
| `parent_tag_fully_qualified_name` | `parentTagFullyQualifiedName` | query | string |  | Fully-qualified API name of the parent tag. Scopes the list to direct children. Since v67.0. |
| `search_string` | `searchString` | query | string |  | Search keyword to match against the developer name or label. Since v67.0. |
| `taxonomy_name` | `taxonomyName` | query | string |  | Fully-qualified API name of the tag taxonomy (for example, `Compliance_Tags`). Scopes the list to tags under that taxonomy. Since v67.0. |

```sql
CALL cdp.tag_list ();
```

**Result**

One row per item of `/tags` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TagRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classifications` | `classifications` | JSON (array of ClassificationLookupRepresentation) | Classifications associated with the tag. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the tag was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the tag in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the tag. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the tag was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag. Terminal segment only. Since v67.0. |
| `parent_tag` | `parentTag` | JSON (TagLookupRepresentation) | Parent tag reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the tag. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the tag resource. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The option text says `order_by` takes `ASC` or `DESC`, but the spec's error example says "Invalid order_by field. Valid fields: Label, DeveloperName." Sources conflict, so test before relying on it. The option text says `offset` must be greater than zero, while other lists in this family only require non-negative. Omit it on the first page.

## tag_get

`GET /ssot/data-governance/tags/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D/get) · evidence O · read-only

Returns a tag by its fully qualified API name. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully qualified API name of the tag. |

```sql
CALL cdp.tag_get (fully_qualified_name => 'Compliance_Tags.PII.Email');
```

**Result**

One row. Schema `TagRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classifications` | `classifications` | JSON (array of ClassificationLookupRepresentation) | Classifications associated with the tag. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the tag was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the tag in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the tag. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the tag was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag. Terminal segment only. Since v67.0. |
| `parent_tag` | `parentTag` | JSON (TagLookupRepresentation) | Parent tag reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the tag. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the tag resource. Since v67.0. |

## tag_assignments_tag_list

`GET /ssot/data-governance/tags/{fullyQualifiedName}/assignments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D~1assignments/get) · evidence O · read-only

Returns a paginated list of tag assignments for a specific tag. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the tag (dotted path). Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of tag assignments to return. The spec's error text says `5` through `200`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |

```sql
CALL cdp.tag_assignments_tag_list (fully_qualified_name => 'Compliance_Tags.PII.Email');
```

**Result**

One row per item of `/tagAssignments` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `count`, `limit`, `offset`, `previousPageUrl`. Schema `TagAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `field_label` | `fieldLabel` | VARCHAR | Label of the field the tag is assigned to. Since v67.0. |
| `field_name` | `fieldName` | VARCHAR | Name of the field the tag is assigned to. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the tag assignment. Since v67.0. |
| `object_label` | `objectLabel` | VARCHAR | Label of the object the tag is assigned to. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Name of the object the tag is assigned to. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the assigned tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the assigned tag (dotted path). Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the assigned tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the assigned tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the assigned tag (terminal segment only). Since v67.0. |

**Paging:** `next_page_url`.

## tag_detection_instruction_get

`GET /ssot/data-governance/tags/{fullyQualifiedName}/detection-instructions/active` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D~1detection-instructions~1active/get) · evidence O · read-only

Returns the currently active detection instruction for a tag. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the tag (dotted path). |

```sql
CALL cdp.tag_detection_instruction_get (fully_qualified_name => 'Compliance_Tags.PII.CreditCard');
```

**Result**

One row. Schema `TagDetectionInstructionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the detection instruction was created. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the detection instruction. Since v67.0. |
| `instruction_txt` | `instructionTxt` | VARCHAR | LLM detection-instruction (prompt) body. Since v67.0. |
| `is_active` | `isActive` | BOOLEAN | Indicates whether the version is the currently active instruction for the tag (`true`) or not (`false`). Since v67.0. |
| `last_synced_date` | `lastSyncedDate` | TIMESTAMPTZ | Timestamp of the last successful off-core sync. Null until the first sync. Since v67.0. |
| `off_core_sync_state` | `offCoreSyncState` | VARCHAR | Off-core sync state. Values are `NotSynced`, `Syncing`, `Synced`, or `Error`. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the tag the instruction is bound to. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the detection instruction resource. Since v67.0. |
| `version` | `version` | BIGINT | Monotonically increasing version of the instruction within the tag. Since v67.0. |

**Notes:** Despite the name, this returns the one active instruction, not a list of versions. No call reads older versions.

## access_policy_update

`PATCH /ssot/data-governance/access-policies/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies~1%7Bname%7D/patch) · evidence O · changes org state

Applies an idempotent partial update to an access policy's label or description. To modify rules, use the PUT rules endpoint instead. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Developer name of the access policy. |
| `description` | `description` | body | string |  | Description of the policy. Omit to leave unchanged. Since v67.0. |
| `label` | `label` | body | string |  | Display label for the policy. Omit to leave unchanged. Since v67.0. |

```sql
CALL cdp.access_policy_update (name => 'RestrictSensitiveFields', label => 'Regional Masking Updated', description => 'Updated policy description.');
```

**Result**

One row. Schema `AccessPolicyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `builder_compatible` | `builderCompatible` | BOOLEAN | Indicates whether the policy was authored to be renderable in the access policy builder (`true`) or not (`false`). Since v67.0. |
| `builder_validated` | `builderValidated` | BOOLEAN | Indicates whether the access policy validator has run for the policy (`true`) or not (`false`). Read-only; the server derives this value on save. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the policy. Since v67.0. |
| `rules` | `rules` | JSON (array of AccessPolicyRuleRepresentation) | Rules contained in the policy. The access policy builder restricts a policy to one rule; multi-rule policies have `builder_compatible` set to `false`. Since v67.0. |

**Notes:** Rules can't change here: a body with rules returns `RULE_MUTATION_NOT_SUPPORTED`. Use `access_policy_rule_replace`.

## classification_taxonomy_update

`PATCH /ssot/data-governance/classification-taxonomies/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies~1%7Bname%7D/patch) · evidence O · changes org state

Updates a classification taxonomy. Omitted fields are left unchanged. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | API name or developer name of the classification taxonomy. |
| `description` | `description` | body | string |  | Description of the tag taxonomy. Since v67.0. |
| `label` | `label` | body | string |  | Label of the tag taxonomy. Since v67.0. |

```sql
CALL cdp.classification_taxonomy_update (name => 'Compliance_Classifications', description => 'Sensitivity and compliance classifications for regulated workloads.');
```

**Result**

One row. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

## classification_update

`PATCH /ssot/data-governance/classifications/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1%7BfullyQualifiedName%7D/patch) · evidence O · changes org state

Updates a classification. Omitted fields are left unchanged. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the classification. |
| `description` | `description` | body | string |  | Updated description. Since v67.0. |
| `label` | `label` | body | string |  | Updated display label. Since v67.0. |
| `tag_fully_qualified_names` | `tagFullyQualifiedNames` | body | array of string |  | Replaces all tag links. Maximum of 200 items. Provide an empty list to remove all links. Omit to leave unchanged. Since v67.0. |

```sql
CALL cdp.classification_update (fully_qualified_name => 'Compliance_Classifications.PII', description => 'Personally identifiable information, direct and indirect identifiers.', tag_fully_qualified_names => ['Compliance_Tags.PII.Email', 'Compliance_Tags.PII.CreditCard', 'Compliance_Tags.PII.Phone']);
```

**Result**

One row. Schema `ClassificationRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the classification. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the classification was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the classification. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the classification in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the classification. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the classification. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the classification. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the classification was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the classification. Terminal segment only. Since v67.0. |
| `parent_classification` | `parentClassification` | JSON (ClassificationLookupRepresentation) | Parent classification reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the classification. Since v67.0. |
| `tags` | `tags` | JSON (array of TagLookupRepresentation) | Tags associated with the classification. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of classification. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the classification resource. Since v67.0. |

**Notes:** The spec's error examples include "Referenced tag must be in the same taxonomy", while its own sample links a classification in `Compliance_Classifications` to tags in `Compliance_Tags`. Sources conflict.

## tag_taxonomy_update

`PATCH /ssot/data-governance/tag-taxonomies/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1%7BfullyQualifiedName%7D/patch) · evidence O · changes org state

Updates a tag taxonomy. Omitted fields are left unchanged. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully qualified API name of the tag taxonomy. A taxonomy has one segment, so this is its developer name, such as `Compliance_Tags`. |
| `description` | `description` | body | string |  | Description of the tag taxonomy. Since v67.0. |
| `label` | `label` | body | string |  | Label of the tag taxonomy. Since v67.0. |

```sql
CALL cdp.tag_taxonomy_update (fully_qualified_name => 'Compliance_Tags', label => 'Compliance Tags (GA)', description => 'Compliance-related tags: PII, financial and health indicators.');
```

**Result**

One row. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

## tag_update

`PATCH /ssot/data-governance/tags/{fullyQualifiedName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D/patch) · evidence O · changes org state

Updates a tag. Omitted fields are left unchanged. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully qualified API name of the tag. |
| `classification_fully_qualified_names` | `classificationFullyQualifiedNames` | body | array of string |  | Replaces all classification links. Maximum of 200 items. Provide an empty list to remove all links. Omit to leave unchanged. Since v67.0. |
| `description` | `description` | body | string |  | Updated description. Since v67.0. |
| `label` | `label` | body | string |  | Updated display label. Since v67.0. |
| `parent_tag_fully_qualified_name` | `parentTagFullyQualifiedName` | body | string |  | Fully-qualified API name of the new parent tag. Provide `null` to move the tag to the root level. Must be in the same taxonomy. Since v67.0. |

```sql
CALL cdp.tag_update (fully_qualified_name => 'Compliance_Tags.PII.Email', label => 'Email Address (PII)', description => 'Personal and work email fields.', classification_fully_qualified_names => ['Compliance_Classifications.PII', 'Compliance_Classifications.Sensitive']);
```

**Result**

One row. Schema `TagRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classifications` | `classifications` | JSON (array of ClassificationLookupRepresentation) | Classifications associated with the tag. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the tag was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the tag in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the tag. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the tag was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag. Terminal segment only. Since v67.0. |
| `parent_tag` | `parentTag` | JSON (TagLookupRepresentation) | Parent tag reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the tag. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the tag resource. Since v67.0. |

**Notes:** The spec doesn't say whether moving a tag with `parent_tag_fully_qualified_name` changes its `fully_qualified_name`, which contains the path.

## access_policy_create

`POST /ssot/data-governance/access-policies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies/post) · evidence O · changes org state

Creates an access policy, with optional inline rules, using all-or-none semantics. A builder-compatible policy can contain at most one rule. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. |
| `description` | `description` | body | string |  | Description of the policy. |
| `label` | `label` | body | string |  | Display label of the policy. |
| `name` | `name` | body | string | yes | Developer name of the policy. The spec's error text says alphanumeric with no spaces. |
| `rules` | `rules` | body | array of [AccessPolicyRuleInput](#accesspolicyruleinputrepresentation) |  | Ordered list of rules embedded in the policy. The access policy builder requires exactly one rule. Since v67.0. |

```sql
CALL cdp.access_policy_create (name => 'RestrictSensitiveFields', label => 'Restrict Sensitive Fields', description => 'Restricts read access to sensitive account fields.', rules => [(name = 'Mask_SSN', label = 'Mask SSN', category = 'TRANSFORM_POLICY_RULE_DEFINITION', effect = 'Transform', action = ['Read'], resource_scope_type = 'FIELD', principal_scope_type = 'ANY', resource_domains = ['Account__dlm'], resource_transform = 'FIRST_N_CHARS_RESOURCE_TRANSFORM', resource_transform_arguments = [(type = 'NUMBER', value = '4')], transform_precedence = 100)]);
```

**Result**

One row. Schema `AccessPolicyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `builder_compatible` | `builderCompatible` | BOOLEAN | Indicates whether the policy was authored to be renderable in the access policy builder (`true`) or not (`false`). Since v67.0. |
| `builder_validated` | `builderValidated` | BOOLEAN | Indicates whether the access policy validator has run for the policy (`true`) or not (`false`). Read-only; the server derives this value on save. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the policy. Since v67.0. |
| `rules` | `rules` | JSON (array of AccessPolicyRuleRepresentation) | Rules contained in the policy. The access policy builder restricts a policy to one rule; multi-rule policies have `builder_compatible` set to `false`. Since v67.0. |

**Notes:** A second rule returns `MULTIPLE_RULES_NOT_ALLOWED`, so this call creates at most one rule. The spec's error text says names must be alphanumeric with no spaces, yet its own sample rule is `Mask_SSN`. The schema's `resource_path` values include `TAG` and `CLASSIFICATION`, which is how `when` and `unless` can test labels: [ABAC uses tags and classifications as attributes](https://help.salesforce.com/s/articleView?id=data.c360_a_policy_types_in_dg.htm&language=en_US) (Help, seen only in a search excerpt). No source shows a filled condition. From the schema alone, the shape is `when = (operator = 'AND', operands = [(condition = (clause = 'WHEN', resource_path = 'TAG', operator = 'EQUALS', values = [(reference = 'Compliance_Tags.PII.Email', reference_type = 'CUSTOM_TAG')]))])`. Which operator suits `TAG` isn't documented.

## classification_assignment_create

`POST /ssot/data-governance/classification-assignments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-assignments/post) · evidence O · changes org state

Creates a single data governance classification assignment. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | body | string | yes | Fully-qualified API name of the source classification. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | body | string | yes | Fully-qualified API name of the target tag. Since v67.0. |

```sql
CALL cdp.classification_assignment_create (classification_fully_qualified_name => 'Compliance_Classifications.PII', tag_fully_qualified_name => 'Compliance_Tags.PII.Email');
```

**Result**

One row. Schema `ClassificationAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classification_fully_qualified_label` | `classificationFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the classification (dotted path of ancestor labels). Since v67.0. |
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | VARCHAR | Fully-qualified API name of the source classification. Since v67.0. |
| `classification_id` | `classificationId` | VARCHAR | ID of the source classification. Since v67.0. |
| `classification_label` | `classificationLabel` | VARCHAR | Leaf display label of the classification. Since v67.0. |
| `classification_name` | `classificationName` | VARCHAR | Leaf developer name of the source classification. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the classification assignment. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the target tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the target tag. Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the target tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the target tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the target tag. Since v67.0. |

**Notes:** This links a classification to a tag. To label data, use `tag_assignment_create`. `classification_update` and `tag_update` can change the same links.

## classification_assignment_bulk_create

`POST /ssot/data-governance/classification-assignments/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-assignments~1actions~1bulk-create/post) · evidence O · changes org state

Bulk creates data governance classification assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `assignments` | `assignments` | body | array of [ClassificationAssignmentBulkItemInput](#classificationassignmentbulkiteminputrepresentation) | yes | List of classification assignment bulk items, each containing a classification and its target tags. Since v67.0. |

```sql
CALL cdp.classification_assignment_bulk_create (assignments => [(classification_fully_qualified_name = 'Compliance_Classifications.PII', tag_fully_qualified_names = ['Compliance_Tags.PII.Email', 'Compliance_Tags.PII.CreditCard', 'Compliance_Tags.PII.Phone']), (classification_fully_qualified_name = 'Compliance_Classifications.Sensitive', tag_fully_qualified_names = ['Compliance_Tags.PII.CreditCard'])]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_assignment_bulk_delete

`POST /ssot/data-governance/classification-assignments/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-assignments~1actions~1bulk-delete/post) · evidence O · changes org state

Bulk deletes data governance classification assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ids` | `ids` | body | array of string | yes | List of classification assignment IDs to delete. Since v67.0. |

```sql
CALL cdp.classification_assignment_bulk_delete (ids => ['9aa000000000050', '9aa000000000053']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_taxonomy_create

`POST /ssot/data-governance/classification-taxonomies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies/post) · evidence O · changes org state

Creates a classification taxonomy. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `description` | `description` | body | string |  | Description of the classification taxonomy. |
| `label` | `label` | body | string |  | Label of the classification taxonomy. Must be unique. |
| `name` | `name` | body | string |  | Developer name of the classification taxonomy, with no `.`. A managed-package namespace prefix is allowed. |

```sql
CALL cdp.classification_taxonomy_create (name => 'Compliance_Classifications', label => 'Compliance Classifications', description => 'Sensitivity and compliance classifications.');
```

**Result**

One row. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

**Notes:** The spec marks `name` optional and its sample omits it, but its error examples include "Name is required." Pass it. The name is one developer name with no `.`, and labels must be unique.

## classification_taxonomy_bulk_create

`POST /ssot/data-governance/classification-taxonomies/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies~1actions~1bulk-create/post) · evidence O · changes org state

Creates multiple classification taxonomies in a single request. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `taxonomies` | `taxonomies` | body | array of [TaxonomyCreateInput](#taxonomycreateinputrepresentation) |  | List of tag taxonomies to create. Since v67.0. |

```sql
CALL cdp.classification_taxonomy_bulk_create (taxonomies => [(name = 'Compliance_Classifications', label = 'Compliance Classifications', description = 'Sensitivity classifications.'), (name = 'Data_Residency_Classifications', label = 'Data Residency Classifications', description = 'Region-of-origin classifications.')]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_taxonomy_bulk_delete

`POST /ssot/data-governance/classification-taxonomies/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies~1actions~1bulk-delete/post) · evidence O · changes org state

Deletes multiple classification taxonomies in a single request. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `names` | `names` | body | array of string |  | List tag taxonomies to delete. Since v67.0. |

```sql
CALL cdp.classification_taxonomy_bulk_delete (names => ['Compliance_Classifications', 'Data_Residency_Classifications']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_taxonomy_bulk_update

`POST /ssot/data-governance/classification-taxonomies/actions/bulk-update` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classification-taxonomies~1actions~1bulk-update/post) · evidence O · changes org state

Updates multiple classification taxonomies in a single request. Omitted fields are left unchanged. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `items` | `items` | body | array of [TaxonomyBulkUpdateItemInput](#taxonomybulkupdateiteminputrepresentation) |  | List of tag taxonomies to update. Since v67.0. |

```sql
CALL cdp.classification_taxonomy_bulk_update (items => [(name = 'Compliance_Classifications', label = 'Compliance Classifications (GA)'), (name = 'Data_Residency_Classifications', description = 'Data residency and sovereignty classifications.')]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_create

`POST /ssot/data-governance/classifications` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications/post) · evidence O · changes org state

Creates a classification under a specified classification taxonomy, with optional initial tag links. If a tag link fails, the classification is still created and the failed tag link is reported. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `description` | `description` | body | string |  | Description of the classification. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | body | string |  | Fully-qualified API name of the classification in dotted path format. Use 2-3 segments: `<TaxonomyName>.<Level1>[.<Level2>]`. Since v67.0. |
| `label` | `label` | body | string |  | Display label of the classification. Since v67.0. |
| `tag_fully_qualified_names` | `tagFullyQualifiedNames` | body | array of string |  | Fully-qualified API names of tags to associate with the classification. Maximum of 200 items. Since v67.0. |

```sql
CALL cdp.classification_create (fully_qualified_name => 'Compliance_Classifications.PII', label => 'PII', description => 'Personally identifiable information.', tag_fully_qualified_names => ['Compliance_Tags.PII.Email', 'Compliance_Tags.PII.CreditCard']);
```

**Result**

One row. Schema `ClassificationRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the classification. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the classification was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the classification. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the classification in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the classification. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the classification. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the classification. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the classification was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the classification. Terminal segment only. Since v67.0. |
| `parent_classification` | `parentClassification` | JSON (ClassificationLookupRepresentation) | Parent classification reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the classification. Since v67.0. |
| `tags` | `tags` | JSON (array of TagLookupRepresentation) | Tags associated with the classification. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of classification. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the classification resource. Since v67.0. |

**Notes:** The spec marks `fully_qualified_name` optional, yet it's rejected unless it has 2 or 3 segments, and the taxonomy in the first segment must exist. The schema has no field for a failed tag link, so compare `tags` in the result with what you sent.

## classification_bulk_create

`POST /ssot/data-governance/classifications/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1actions~1bulk-create/post) · evidence O · changes org state

Creates multiple classifications in a single request. Maximum of 200 items per request. If a tag link fails for an item, the classification is still created. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `classifications` | `classifications` | body | array of [ClassificationCreateInput](#classificationcreateinputrepresentation) |  | List of classification create inputs. Since v67.0. |

```sql
CALL cdp.classification_bulk_create (classifications => [(fully_qualified_name = 'Compliance_Classifications.PII', label = 'PII', description = 'Personally identifiable information.'), (fully_qualified_name = 'Compliance_Classifications.Sensitive', label = 'Sensitive', description = 'Sensitive data requiring handling controls.', tag_fully_qualified_names = ['Compliance_Tags.PII.CreditCard'])]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_bulk_delete

`POST /ssot/data-governance/classifications/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1actions~1bulk-delete/post) · evidence O · changes org state

Deletes multiple classifications in a single request, cascading each deletion to its child classifications and assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_names` | `fullyQualifiedNames` | body | array of string |  | Fully-qualified API names of classifications to delete. Maximum of 200 items. Since v67.0. |

```sql
CALL cdp.classification_bulk_delete (fully_qualified_names => ['Compliance_Classifications.Sensitive']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## classification_bulk_update

`POST /ssot/data-governance/classifications/actions/bulk-update` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1classifications~1actions~1bulk-update/post) · evidence O · changes org state

Updates multiple classifications in a single request. Omitted fields are left unchanged. Tag validation runs against the state before the batch operation. If a tag link fails, the classification is updated, but the tag link change is not applied, and an error is reported Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `items` | `items` | body | array of [ClassificationBulkUpdateItemInput](#classificationbulkupdateiteminputrepresentation) |  | List of classification update items. Since v67.0. |

```sql
CALL cdp.classification_bulk_update (items => [(fully_qualified_name = 'Compliance_Classifications.PII', description = 'All PII classifications.'), (fully_qualified_name = 'Compliance_Classifications.Sensitive', label = 'Sensitive Data'), (fully_qualified_name = 'Compliance_Classifications.Restricted', tag_fully_qualified_names = ['Compliance_Tags.PII.SSN', 'Compliance_Tags.PII.CreditCard'])]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## object_access_grant_create

`POST /ssot/data-governance/object-access-grants` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1object-access-grants/post) · evidence O · changes org state

Creates a single object access grant using an idempotent request. If a matching grant already exists, the API returns the existing record; otherwise, it creates and returns a new grant. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space that the grant belongs to. Since v67.0. |
| `object_api_name` | `objectApiName` | body | string | yes | API name of the Data Cloud object to grant access to. Since v67.0. |
| `permission_set_name` | `permissionSetName` | body | string | yes | Developer name of the permission set. Since v67.0. |

```sql
CALL cdp.object_access_grant_create (permission_set_name => 'DC_Analyst_PermSet', dataspace_name => 'default', object_api_name => 'Account__dlm');
```

**Result**

One row. Schema `DataGovernanceObjectAccessGrantRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the grant. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Timestamp when the grant was created. Since v67.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Name of the data space that the grant belongs to. Since v67.0. |
| `object_api_name` | `objectApiName` | VARCHAR | API name of the granted Data Cloud object. Since v67.0. |
| `permission_set_name` | `permissionSetName` | VARCHAR | Developer name of the permission set. Since v67.0. |

**Notes:** The permission set must already have the data space assigned, or the call returns "There is no Permission Set {permissionSetName} with assigned Dataspace {dataspaceName}". The spec marks `dataSpaceName` optional, but its error examples include "dataspaceName is required", so pass it. The list call accepts DMO, DLO and CIO names.

## object_access_grant_bulk_create

`POST /ssot/data-governance/object-access-grants/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1object-access-grants~1actions~1bulk-create/post) · evidence O · changes org state

Creates multiple object access grants for a single combination of a data space and a permission set using an idempotent request. A request supports a maximum of 200 items. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space that the grants belong to. Since v67.0. |
| `object_api_names` | `objectApiNames` | body | array of string | yes | List of Data Cloud object API names to grant access to. Maximum of 200. Since v67.0. |
| `permission_set_name` | `permissionSetName` | body | string | yes | Developer name of the permission set. Since v67.0. |

```sql
CALL cdp.object_access_grant_bulk_create (permission_set_name => 'DC_Analyst_PermSet', dataspace_name => 'default', object_api_names => ['Account__dlm', 'Contact__dlm', 'revenue_insights__cio']);
```

**Result**

One row. Schema `DataGovernanceObjectAccessGrantBulkCreateResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of DataGovernanceObjectAccessGrantBulkResultItemRepresentation) | Per-item results, in the same order as the input list. Since v67.0. |

**Notes:** Same prerequisite and `dataspace_name` conflict as `object_access_grant_create`. Failed items carry a list of errors in `results[].result`.

## object_access_grant_bulk_delete

`POST /ssot/data-governance/object-access-grants/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1object-access-grants~1actions~1bulk-delete/post) · evidence O · changes org state

Deletes multiple object access grants for a single combination of a data space and a permission set using an idempotent request. If a specified grant doesn't exist, no action is taken for that item. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space that the grants belong to. Since v67.0. |
| `object_api_names` | `objectApiNames` | body | array of string | yes | List of Data Cloud object API names to remove grants for. Maximum of 200. Since v67.0. |
| `permission_set_name` | `permissionSetName` | body | string | yes | Developer name of the permission set. Since v67.0. |

```sql
CALL cdp.object_access_grant_bulk_delete (permission_set_name => 'DC_Analyst_PermSet', dataspace_name => 'default', object_api_names => ['Account__dlm', 'revenue_insights__cio']);
```

**Result**

One row. Schema `DataGovernanceObjectAccessGrantBulkDeleteResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of DataGovernanceObjectAccessGrantBulkResultItemRepresentation) | Per-item results, in the same order as the input list. Since v67.0. |

**Notes:** The description says a missing grant is a no-op, while the spec's error text says such an item returns `RESOURCE_NOT_FOUND`. Sources conflict, so don't treat that item error as fatal. Duplicate names return "Duplicate identifier in request".

## tag_assignment_create

`POST /ssot/data-governance/tag-assignments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-assignments/post) · evidence O · changes org state

Creates a single data governance tag assignment. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `field_name` | `fieldName` | body | string |  | API name of the field. Requires `object_name`. Since v67.0. |
| `object_name` | `objectName` | body | string |  | API name of the data object. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | body | string | yes | Fully-qualified API name of the tag to assign. Since v67.0. |

```sql
CALL cdp.tag_assignment_create (tag_fully_qualified_name => 'Compliance_Tags.PII.Email', object_name => 'Individual_DLO__dll', field_name => 'Email');
```

**Result**

One row. Schema `TagAssignmentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `field_label` | `fieldLabel` | VARCHAR | Label of the field the tag is assigned to. Since v67.0. |
| `field_name` | `fieldName` | VARCHAR | Name of the field the tag is assigned to. Since v67.0. |
| `id` | `id` | VARCHAR | ID of the tag assignment. Since v67.0. |
| `object_label` | `objectLabel` | VARCHAR | Label of the object the tag is assigned to. Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Name of the object the tag is assigned to. Since v67.0. |
| `tag_fully_qualified_label` | `tagFullyQualifiedLabel` | VARCHAR | Hierarchical display label of the assigned tag (dotted path of ancestor labels). Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the assigned tag (dotted path). Since v67.0. |
| `tag_id` | `tagId` | VARCHAR | ID of the assigned tag. Since v67.0. |
| `tag_label` | `tagLabel` | VARCHAR | Leaf display label of the assigned tag. Since v67.0. |
| `tag_name` | `tagName` | VARCHAR | Leaf developer name of the assigned tag (terminal segment only). Since v67.0. |

**Notes:** An unknown object returns 404. Assigning a child tag [also applies its parent tag](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_using_tagging_and_classification_dg.htm&type=5) (Help, seen only in a search excerpt). The spec's samples target DLOs (`__dll`).

## tag_assignment_bulk_create

`POST /ssot/data-governance/tag-assignments/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-assignments~1actions~1bulk-create/post) · evidence O · changes org state

Bulk creates data governance tag assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `assignments` | `assignments` | body | array of array of [TagAssignmentTargetInput](#tagassignmenttargetinputrepresentation) | yes | List of tag assignment bulk items, each containing a tag and its targets. Since v67.0. |

```sql
CALL cdp.tag_assignment_bulk_create (assignments => [(tag_fully_qualified_name = 'Compliance_Tags.PII.Email', targets = [(object_name = 'Individual_DLO__dll', field_name = 'Email'), (object_name = 'Contact_DLO__dll', field_name = 'PersonalEmail')]), (tag_fully_qualified_name = 'Compliance_Tags.PII.CreditCard', targets = [(object_name = 'Payment_DLO__dll', field_name = 'CardPAN')])]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Notes:** The spec's types and sample disagree. The schema types `assignments` as an array of arrays of targets, while its description and sample use objects with `tag_fully_qualified_name` and `targets`. The example follows the sample, so completion from the table would miss those two attributes. The spec's sample has an intentionally failing target, removed here.

## tag_assignment_bulk_delete

`POST /ssot/data-governance/tag-assignments/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-assignments~1actions~1bulk-delete/post) · evidence O · changes org state

Bulk deletes data governance tag assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ids` | `ids` | body | array of string | yes | List of tag assignment IDs to delete. Since v67.0. |

```sql
CALL cdp.tag_assignment_bulk_delete (ids => ['9aa000000000001', '9aa000000000002']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## tag_suggestions_approve

`POST /ssot/data-governance/tag-suggestions/actions/approve` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-suggestions~1actions~1approve/post) · evidence O · changes org state

Approves one or more tag suggestions. Each item returns status code 200 on success, 404 if the suggestion isn't found, or 400 if the suggestion is in a terminal state. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ids` | `ids` | body | array of string | yes | List of core record IDs (18 characters). Maximum 200. Since v67.0. |

```sql
CALL cdp.tag_suggestions_approve (ids => ['1dg000000000001', '1dg000000000002']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Notes:** Approval creates the tag assignment; see `assignment_id` on the suggestion. An item in a terminal state returns 400 in its result. The spec doesn't list the terminal statuses, but `processed_date` is null only for `New`. The option says ids have 18 characters, while the spec's samples have 15. The spec's sample has an intentionally unknown id, removed here.

## tag_suggestions_generate

`POST /ssot/data-governance/tag-suggestions/actions/generate` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-suggestions~1actions~1generate/post) · evidence O · changes org state

Launches asynchronous AI-driven tag suggestion jobs for one or more objects. Returns per-object job IDs. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_names` | `objectNames` | body | array of string | yes | Data object API names to generate tag suggestions for. Maximum 20. Since v67.0. |
| `taxonomy_names` | `taxonomyNames` | body | array of string | yes | Flat developer names of the tag taxonomies to source suggestions from. Maximum 20. Since v67.0. |

```sql
CALL cdp.tag_suggestions_generate (object_names => ['Individual_DLO__dll', 'Account_DLO__dll'], taxonomy_names => ['Compliance_Tags']);
```

**Result**

One row per item of `/jobs` in the response. Schema `SuggestTagsJobRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `job_id` | `jobId` | VARCHAR | ID of the auto-tagging job (references DataObjectAutoTaggingJob). Since v67.0. |
| `object_name` | `objectName` | VARCHAR | Target object API name, echoed back from the request for client correlation. Since v67.0. |

**Done when:** `auto_tagging_job_get.status` for each `job_id` is `Success` or `Fail`. It's `InProgress` while running.

**Notes:** Needs `GovernanceAiSuggestTags`, like every suggestion and job call. The LLM [reads object and field metadata such as names and descriptions](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_using_tagging_and_classification_dg.htm&type=5), and an admin still reviews the results (Help, seen only in a search excerpt). An object with a running job returns 400, and too many running jobs return 429: `MaxConcurrentAutoTagJobs`, default 100. The sources read don't state a credit cost.

## tag_suggestions_reject

`POST /ssot/data-governance/tag-suggestions/actions/reject` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-suggestions~1actions~1reject/post) · evidence O · changes org state

Rejects one or more tag suggestions. Each item returns status code 200 on success, 404 if the suggestion isn't found, or 400 if the suggestion is in a terminal state. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ids` | `ids` | body | array of string | yes | List of core record IDs (18 characters). Maximum 200. Since v67.0. |

```sql
CALL cdp.tag_suggestions_reject (ids => ['1dg000000000003', '1dg000000000004']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Notes:** An item in a terminal state returns 400 in its result. The spec doesn't list the terminal statuses, but `processed_date` is null only for `New`.

## tag_taxonomy_create

`POST /ssot/data-governance/tag-taxonomies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies/post) · evidence O · changes org state

Creates a top-level tag taxonomy. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `description` | `description` | body | string |  | Description of the tag taxonomy. Since v67.0. |
| `label` | `label` | body | string |  | Label of the tag taxonomy. Must be unique. |
| `name` | `name` | body | string |  | Developer name of the tag taxonomy, with no `.`. A managed-package namespace prefix is allowed. |

```sql
CALL cdp.tag_taxonomy_create (name => 'Compliance_Tags', label => 'Compliance Tags', description => 'Compliance-related tags (PII, financial, health).');
```

**Result**

One row. Schema `TaxonomyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `child_count` | `childCount` | BIGINT | Number of direct child tags. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag taxonomy. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag taxonomy. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag taxonomy. Since v67.0. |
| `label` | `label` | VARCHAR | Label of the tag taxonomy. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag taxonomy. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the tag taxonomy was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag taxonomy. Since v67.0. |
| `state` | `state` | VARCHAR | Current state of the tag taxonomy. Since v67.0. |
| `taxonomy_kind` | `taxonomyKind` | VARCHAR | Kind of tag taxonomy. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag taxonomy. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the taxonomy resource. Since v67.0. |

**Notes:** The spec marks `name` optional and its sample omits it, but its error examples include "Name is required." Pass it. The name is one developer name with no `.`, and labels must be unique.

## tag_detection_instruction_bulk_create

`POST /ssot/data-governance/tag-taxonomies/{fullyQualifiedName}/detection-instructions/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1%7BfullyQualifiedName%7D~1detection-instructions~1actions~1bulk-create/post) · evidence O · changes org state

Bulk creates active detection instructions for multiple tags under one taxonomy. Each item creates or replaces the active instruction for one tag. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the tag taxonomy. Since v67.0. |
| `detection_instructions` | `detectionInstructions` | body | array of [TagDetectionInstructionBulkCreateItem](#tagdetectioninstructionbulkcreateitemrepresentation) | yes | List of per-tag detection instruction create items. Maximum 200. Since v67.0. |

```sql
CALL cdp.tag_detection_instruction_bulk_create (fully_qualified_name => 'Compliance_Tags', detection_instructions => [(tag_fully_qualified_name = 'Compliance_Tags.PII.CreditCard', instruction_txt = 'Detect credit card numbers: 16-digit Luhn-valid sequences, card-type prefixes.'), (tag_fully_qualified_name = 'Compliance_Tags.PII.SSN', instruction_txt = 'Detect US Social Security Numbers: NNN-NN-NNNN format or 9-digit numeric sequences.')]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Done when:** `tags_active_detection_instruction_list.active_detection_instruction` has `off_core_sync_state` `Synced` for each tag, or `Error` on failure.

**Notes:** `fully_qualified_name` is the taxonomy, and each item names a tag in it. Each `instruction_txt` is capped at 100 characters.

## tag_taxonomy_bulk_create

`POST /ssot/data-governance/tag-taxonomies/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1actions~1bulk-create/post) · evidence O · changes org state

Creates multiple tag taxonomies in a single request. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `taxonomies` | `taxonomies` | body | array of [TaxonomyCreateInput](#taxonomycreateinputrepresentation) |  | List of tag taxonomies to create. Since v67.0. |

```sql
CALL cdp.tag_taxonomy_bulk_create (taxonomies => [(name = 'Compliance_Tags', label = 'Compliance Tags', description = 'Compliance-related tags.'), (name = 'Ethics_Tags', label = 'Ethics Tags', description = 'Ethical AI compliance indicators.'), (name = 'Marketing_Tags', label = 'Marketing Tags', description = 'Marketing consent and preference tags.')]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## tag_taxonomy_bulk_delete

`POST /ssot/data-governance/tag-taxonomies/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1actions~1bulk-delete/post) · evidence O · changes org state

Deletes multiple tag taxonomies and all child tags in a single request. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `names` | `names` | body | array of string |  | List tag taxonomies to delete. Since v67.0. |

```sql
CALL cdp.tag_taxonomy_bulk_delete (names => ['Marketing_Tags', 'Unused_Tags']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## tag_taxonomy_bulk_update

`POST /ssot/data-governance/tag-taxonomies/actions/bulk-update` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tag-taxonomies~1actions~1bulk-update/post) · evidence O · changes org state

Updates multiple tag taxonomies in a single request. Omitted fields are left unchanged. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `items` | `items` | body | array of [TaxonomyBulkUpdateItemInput](#taxonomybulkupdateiteminputrepresentation) |  | List of tag taxonomies to update. Since v67.0. |

```sql
CALL cdp.tag_taxonomy_bulk_update (items => [(name = 'Compliance_Tags', label = 'Compliance Tags (GA)'), (name = 'Ethics_Tags', description = 'Ethical AI tags — caste, gender, accessibility.')]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## tag_create

`POST /ssot/data-governance/tags` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags/post) · evidence O · changes org state

Creates a tag under a specified tag taxonomy, optionally nested under a parent tag. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `classification_fully_qualified_names` | `classificationFullyQualifiedNames` | body | array of string |  | Fully-qualified API names of classifications to associate with the tag. Maximum of 200 items. Since v67.0. |
| `description` | `description` | body | string |  | Description of the tag. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | body | string |  | Fully-qualified API name of the tag in dotted path format. Use 2-3 segments: `<TaxonomyName>.<Level1>[.<Level2>]`. Since v67.0. |
| `label` | `label` | body | string |  | Display label of the tag. Since v67.0. |

```sql
CALL cdp.tag_create (fully_qualified_name => 'Compliance_Tags.PII.Email', label => 'Email Address', description => 'Personally identifiable email addresses.', classification_fully_qualified_names => ['Compliance_Classifications.PII']);
```

**Result**

One row. Schema `TagRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `classifications` | `classifications` | JSON (array of ClassificationLookupRepresentation) | Classifications associated with the tag. Since v67.0. |
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | User who created the tag. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the tag was created. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the tag. Since v67.0. |
| `fully_qualified_label` | `fullyQualifiedLabel` | VARCHAR | Hierarchical display label in dotted path format of ancestor labels. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | VARCHAR | Fully-qualified API name of the tag in dotted path format. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the tag. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the tag. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | User who last modified the tag. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date the tag was last modified. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the tag. Terminal segment only. Since v67.0. |
| `parent_tag` | `parentTag` | JSON (TagLookupRepresentation) | Parent tag reference. Since v67.0. |
| `state` | `state` | VARCHAR | State of the tag. Since v67.0. |
| `taxonomy` | `taxonomy` | JSON (TaxonomyLookupRepresentation) | Taxonomy reference. Since v67.0. |
| `type` | `type` | VARCHAR | Type of tag. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the tag resource. Since v67.0. |

**Notes:** The parent comes from the path, and it and the taxonomy must already exist. The spec marks `fully_qualified_name` optional, yet it's rejected unless it has 2 or 3 segments.

## tag_detection_instruction_create

`POST /ssot/data-governance/tags/{fullyQualifiedName}/detection-instructions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1%7BfullyQualifiedName%7D~1detection-instructions/post) · evidence O · changes org state

Creates or replaces the active detection instruction for a tag. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_name` | `fullyQualifiedName` | path | string | yes | Fully-qualified API name of the tag (dotted path). Since v67.0. |
| `instruction_txt` | `instructionTxt` | body | string | yes | LLM detection-instruction (prompt) body. Maximum 100 characters. Posting replaces the currently active instruction with a new version. Since v67.0. |

```sql
CALL cdp.tag_detection_instruction_create (fully_qualified_name => 'Compliance_Tags.PII.CreditCard', instruction_txt => 'Detect credit card numbers: 16-digit Luhn-valid sequences, card-type prefixes.');
```

**Result**

One row. Schema `TagDetectionInstructionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_date` | `createdDate` | TIMESTAMPTZ | Date the detection instruction was created. Since v67.0. |
| `id` | `id` | VARCHAR | Unique identifier of the detection instruction. Since v67.0. |
| `instruction_txt` | `instructionTxt` | VARCHAR | LLM detection-instruction (prompt) body. Since v67.0. |
| `is_active` | `isActive` | BOOLEAN | Indicates whether the version is the currently active instruction for the tag (`true`) or not (`false`). Since v67.0. |
| `last_synced_date` | `lastSyncedDate` | TIMESTAMPTZ | Timestamp of the last successful off-core sync. Null until the first sync. Since v67.0. |
| `off_core_sync_state` | `offCoreSyncState` | VARCHAR | Off-core sync state. Values are `NotSynced`, `Syncing`, `Synced`, or `Error`. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | VARCHAR | Fully-qualified API name of the tag the instruction is bound to. Since v67.0. |
| `url` | `url` | VARCHAR | URL of the detection instruction resource. Since v67.0. |
| `version` | `version` | BIGINT | Monotonically increasing version of the instruction within the tag. Since v67.0. |

**Done when:** `tag_detection_instruction_get.off_core_sync_state` is `Synced`, or `Error` on failure. `NotSynced` and `Syncing` come before that.

**Notes:** `instruction_txt` is capped at 100 characters, enforced by a 400. The spec's own sample is about 200 characters, so it's replaced here. The spec doesn't say whether suggestions need the sync to finish.

## tag_bulk_create

`POST /ssot/data-governance/tags/actions/bulk-create` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1actions~1bulk-create/post) · evidence O · changes org state

Creates multiple tags in a single request. Maximum of 200 items per request. A parent tag and its child cannot be created in the same request. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `tags` | `tags` | body | array of [TagCreateInput](#tagcreateinputrepresentation) |  | List of tag create inputs. Since v67.0. |

```sql
CALL cdp.tag_bulk_create (tags => [(fully_qualified_name = 'Compliance_Tags.PII.Phone', label = 'Phone Number', description = 'Phone numbers (personal or business).'), (fully_qualified_name = 'Compliance_Tags.PII.CreditCard', label = 'Credit Card Number', description = 'Credit card PAN, PCI-regulated.', classification_fully_qualified_names = ['Compliance_Classifications.PII', 'Compliance_Classifications.Sensitive'])]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Notes:** Send parents and children in separate calls, parents first. The spec's sample has an intentionally invalid item, removed here.

## tag_bulk_delete

`POST /ssot/data-governance/tags/actions/bulk-delete` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1actions~1bulk-delete/post) · evidence O · changes org state

Deletes multiple tags in a single request, cascading each deletion to its child tags and assignments. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `fully_qualified_names` | `fullyQualifiedNames` | body | array of string |  | Fully-qualified API names of tags to delete. Maximum of 200 items. Since v67.0. |

```sql
CALL cdp.tag_bulk_delete (fully_qualified_names => ['Compliance_Tags.PII.Phone', 'Compliance_Tags.PII.Obsolete']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

## tag_bulk_update

`POST /ssot/data-governance/tags/actions/bulk-update` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1actions~1bulk-update/post) · evidence O · changes org state

Updates multiple tags in a single requests. Omitted fields are left unchanged. Validation runs against the state before the batch operation. For example, if item 1 re-parents tag A and item 2 references tag A, item 2 validates against tag A's ancestry before the batch operation. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `items` | `items` | body | array of [TagBulkUpdateItemInput](#tagbulkupdateiteminputrepresentation) |  | List of tag update items. Since v67.0. |

```sql
CALL cdp.tag_bulk_update (items => [(fully_qualified_name = 'Compliance_Tags.PII.Email', label = 'Email Address (PII)'), (fully_qualified_name = 'Compliance_Tags.PII.Phone', parent_tag_fully_qualified_name = 'Compliance_Tags.PII.Contact'), (fully_qualified_name = 'Compliance_Tags.PII.CreditCard', classification_fully_qualified_names = ['Compliance_Classifications.PII', 'Compliance_Classifications.Sensitive'])]);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Notes:** The spec's sample has an intentionally failing item, removed here.

## tags_propagate

`POST /ssot/data-governance/tags/actions/propagate` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1tags~1actions~1propagate/post) · evidence O · changes org state

Propagates data governance tags to the specified objects. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_names` | `objectNames` | body | array of string | yes | List of object developer names to propagate the tag to. Since v67.0. |

```sql
CALL cdp.tags_propagate (object_names => ['Individual_DLO__dll', 'Contact_DLO__dll']);
```

**Result**

One row. Schema `BatchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether any item failed (`true`) or all items succeeded (`false`). Since v67.0. |
| `results` | `results` | JSON (array of BatchResultItemRepresentation) | List of per-item results in the same order as the input list. Since v67.0. |

**Notes:** The body names objects but no tags, and the spec doesn't say which tags move or whether the work finishes before the call returns. The option says the objects are propagated *to*, while [Help](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_using_tagging_and_classification_dg.htm&type=5) describes tags going from a source object to its downstream objects, and the spec's samples pass DLOs (Help, seen only in a search excerpt). [Data graphs](https://help.salesforce.com/apex/HTViewHelpDoc?id=data.c360_a_data_graph_tag_propagation.htm) also depend on this: a tag added to a DMO after the graph exists needs manual propagation, and a user missing any required tag can't read the graph (same caveat). At most 20 objects.

## access_policy_rule_replace

`PUT /ssot/data-governance/access-policies/{name}/rules/{ruleName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Governance/paths/~1ssot~1data-governance~1access-policies~1%7Bname%7D~1rules~1%7BruleName%7D/put) · evidence O · changes org state

Overwrites or upserts a single rule within an access policy. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Developer name of the parent access policy. |
| `rule_name` | `ruleName` | path | string | yes | Developer name of the rule. Must equal `body_name`. |
| `action` | `action` | body | array of string |  | Actions the rule applies to, such as `Read`. Since v67.0. |
| `category` | `category` | body | enum(ACCESS_POLICY_RULE_DEFINITION, GOVERNANCE_POLICY_RULE_DEFINITION, TRANSFORM_POLICY_RULE_DEFINITION, RECORD_POLICY_RULE_DEFINITION, IDENTIFIED_RECORD_POLICY_RULE_DEFINITION) | yes | MDAPI rule category. Since v67.0. |
| `effect` | `effect` | body | enum(Permit, Forbid, Transform) | yes | Effect of the rule. Since v67.0. |
| `label` | `label` | body | string |  | Display label for the rule. Since v67.0. |
| `body_name` | `name` | body | string | yes | Developer name of the rule (PolicyRuleDefinition fullName). Since v67.0. |
| `principal_authentication_level` | `principalAuthenticationLevel` | body | enum(UNIDENTIFIED, IDENTIFIED, AUTHENTICATED, INTERNAL) |  | Required principal authentication level. Since v67.0. |
| `principal_scope_type` | `principalScopeType` | body | enum(ANY) |  | Principal scope type. Since v67.0. |
| `resource_domains` | `resourceDomains` | body | array of string |  | DMOs or objects the rule scopes to. Required for record-scope (RLS) rules. Since v67.0. |
| `resource_scope_type` | `resourceScopeType` | body | enum(ANY, FIELD, RECORD) |  | Resource scope type. Since v67.0. |
| `resource_transform` | `resourceTransform` | body | enum(LAST_N_CHARS_RESOURCE_TRANSFORM, FIRST_N_CHARS_RESOURCE_TRANSFORM, ALL_BUT_LAST_N_CHARS_RESOURCE_TRANSFORM, ALL_BUT_FIRST_N_CHARS_RESOURCE_TRANSFORM, CLOSEST_ORDER_OF_MAGNITUDE_RESOURCE_TRANSFORM, NULL_RESOURCE_TRANSFORM, EMPTY_STRING_RESOURCE_TRANSFORM, TRUNCATE_DATE_RESOURCE_TRANSFORM, ROUND_RESOURCE_TRANSFORM, REPLACE_ALL_CHARS_RESOURCE_TRANSFORM) |  | For Transform or FLS rules, the transform applied to the field. Since v67.0. |
| `resource_transform_arguments` | `resourceTransformArguments` | body | array of [ResourceTransformArgumentInput](#resourcetransformargumentinputrepresentation) |  | Static argument list for the resource transform, such as the `2` for `FIRST_N_CHARS_RESOURCE_TRANSFORM`. Since v67.0. |
| `rule_consumer` | `ruleConsumer` | body | enum(ALL, DATACLOUD, MULESOFT, TABLEAU, CORE) |  | Consumer of the rule's enforcement. Since v67.0. |
| `transform_precedence` | `transformPrecedence` | body | integer |  | Tiebreaker when multiple Transform rules apply to the same field. The lower value wins. Applies only to Transform-effect rules. Since v67.0. |
| `unless` | `unless` | body | [ConditionGroupInput](#conditiongroupinputrepresentation) |  | Condition group that, when met, exempts the rule from applying. Since v67.0. |
| `when` | `when` | body | [ConditionGroupInput](#conditiongroupinputrepresentation) |  | Condition group that must be met for the rule to apply. Since v67.0. |

```sql
CALL cdp.access_policy_rule_replace (name => 'RestrictSensitiveFields', rule_name => 'Mask_SSN', body_name => 'Mask_SSN', label => 'Mask SSN', category => 'TRANSFORM_POLICY_RULE_DEFINITION', effect => 'Transform', action => ['Read'], resource_scope_type => 'FIELD', principal_scope_type => 'ANY', resource_domains => ['Account__dlm'], resource_transform => 'FIRST_N_CHARS_RESOURCE_TRANSFORM', resource_transform_arguments => [(type = 'NUMBER', value = '4')], transform_precedence => 100);
```

**Result**

One row. Schema `AccessPolicyRuleRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `action` | `action` | JSON | Actions the rule applies to, such as `Read`. Since v67.0. |
| `category` | `category` | VARCHAR | MDAPI rule category, which determines the validator that dispatches. Since v67.0. |
| `effect` | `effect` | VARCHAR | Effect of the rule. Since v67.0. |
| `id` | `id` | VARCHAR | 18-character record ID of the underlying PolicyRuleDefinition. Since v67.0. |
| `label` | `label` | VARCHAR | Display label for the rule. Since v67.0. |
| `name` | `name` | VARCHAR | Developer name of the rule (PolicyRuleDefinition fullName). Since v67.0. |
| `principal_authentication_level` | `principalAuthenticationLevel` | VARCHAR | Required principal authentication level. Since v67.0. |
| `principal_scope_type` | `principalScopeType` | VARCHAR | Principal scope type. Since v67.0. |
| `resource_domains` | `resourceDomains` | JSON | DMOs or objects the rule scopes to. Required for record-scope (RLS) rules; typically empty or absent for OLS or FLS. Since v67.0. |
| `resource_scope_type` | `resourceScopeType` | VARCHAR | Resource scope type. Since v67.0. |
| `resource_transform` | `resourceTransform` | VARCHAR | For Transform or FLS rules, the transform applied to the field before the principal sees it. Since v67.0. |
| `resource_transform_arguments` | `resourceTransformArguments` | JSON (array of ResourceTransformArgumentRepresentation) | Static argument list for the resource transform, such as the `2` for `FIRST_N_CHARS_RESOURCE_TRANSFORM`. Since v67.0. |
| `rule_consumer` | `ruleConsumer` | VARCHAR | Consumer of the rule's enforcement. Since v67.0. |
| `transform_precedence` | `transformPrecedence` | BIGINT | Tiebreaker when multiple Transform rules apply to the same field. The lower value wins. Emitted only on Transform-effect rules. Since v67.0. |
| `unless` | `unless` | JSON (ConditionGroupRepresentation) | Condition group that, when met, exempts the rule from applying. Since v67.0. |
| `when` | `when` | JSON (ConditionGroupRepresentation) | Condition group that must be met for the rule to apply. Since v67.0. |

**Notes:** `rule_name` and `body_name` must be equal, or the call returns `NAME_MISMATCH`. It's a full overwrite, and the schema requires each condition's `id` on update, so read the rule with `access_policy_rule_get` first and send those ids back. No call deletes a single rule, and the spec doesn't show what upserting a second rule into a one-rule policy does. A 403 can mean a missing `CanAccessCustomerDataCloudAPI` or `ModifyAccessPolicies` permission.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### AccessPolicyRuleInputRepresentation

Represents the input for a single rule within an access policy.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `action` | `action` | array of string |  | Actions the rule applies to, such as `Read`. Since v67.0. |
| `category` | `category` | enum(ACCESS_POLICY_RULE_DEFINITION, GOVERNANCE_POLICY_RULE_DEFINITION, TRANSFORM_POLICY_RULE_DEFINITION, RECORD_POLICY_RULE_DEFINITION, IDENTIFIED_RECORD_POLICY_RULE_DEFINITION) | yes | MDAPI rule category. Since v67.0. |
| `effect` | `effect` | enum(Permit, Forbid, Transform) | yes | Effect of the rule. Since v67.0. |
| `label` | `label` | string |  | Display label for the rule. Since v67.0. |
| `name` | `name` | string | yes | Developer name of the rule (PolicyRuleDefinition fullName). Since v67.0. |
| `principal_authentication_level` | `principalAuthenticationLevel` | enum(UNIDENTIFIED, IDENTIFIED, AUTHENTICATED, INTERNAL) |  | Required principal authentication level. Since v67.0. |
| `principal_scope_type` | `principalScopeType` | enum(ANY) |  | Principal scope type. Since v67.0. |
| `resource_domains` | `resourceDomains` | array of string |  | DMOs or objects the rule scopes to. Required for record-scope (RLS) rules. Since v67.0. |
| `resource_scope_type` | `resourceScopeType` | enum(ANY, FIELD, RECORD) |  | Resource scope type. Since v67.0. |
| `resource_transform` | `resourceTransform` | enum(LAST_N_CHARS_RESOURCE_TRANSFORM, FIRST_N_CHARS_RESOURCE_TRANSFORM, ALL_BUT_LAST_N_CHARS_RESOURCE_TRANSFORM, ALL_BUT_FIRST_N_CHARS_RESOURCE_TRANSFORM, CLOSEST_ORDER_OF_MAGNITUDE_RESOURCE_TRANSFORM, NULL_RESOURCE_TRANSFORM, EMPTY_STRING_RESOURCE_TRANSFORM, TRUNCATE_DATE_RESOURCE_TRANSFORM, ROUND_RESOURCE_TRANSFORM, REPLACE_ALL_CHARS_RESOURCE_TRANSFORM) |  | For Transform or FLS rules, the transform applied to the field. Since v67.0. |
| `resource_transform_arguments` | `resourceTransformArguments` | array of [ResourceTransformArgumentInput](#resourcetransformargumentinputrepresentation) |  | Static argument list for the resource transform, such as the `2` for `FIRST_N_CHARS_RESOURCE_TRANSFORM`. Since v67.0. |
| `rule_consumer` | `ruleConsumer` | enum(ALL, DATACLOUD, MULESOFT, TABLEAU, CORE) |  | Consumer of the rule's enforcement. Since v67.0. |
| `transform_precedence` | `transformPrecedence` | integer |  | Tiebreaker when multiple Transform rules apply to the same field. The lower value wins. Applies only to Transform-effect rules. Since v67.0. |
| `unless` | `unless` | [ConditionGroupInput](#conditiongroupinputrepresentation) |  | Condition group that, when met, exempts the rule from applying. Since v67.0. |
| `when` | `when` | [ConditionGroupInput](#conditiongroupinputrepresentation) |  | Condition group that must be met for the rule to apply. Since v67.0. |

### ClassificationAssignmentBulkItemInputRepresentation

Represents a single classification with its list of target tags for bulk creation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `classification_fully_qualified_name` | `classificationFullyQualifiedName` | string | yes | Fully-qualified API name of the source classification. Since v67.0. |
| `tag_fully_qualified_names` | `tagFullyQualifiedNames` | array of string | yes | Fully-qualified API names of the target tags. Maximum 50. Since v67.0. |

### ClassificationBulkUpdateItemInputRepresentation

Represents the input for a single classification item in a bulk update operation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Updated description. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | string |  | Fully-qualified API name of the classification to update. Since v67.0. |
| `label` | `label` | string |  | Updated display label. Since v67.0. |
| `tag_fully_qualified_names` | `tagFullyQualifiedNames` | array of string |  | Replaces all tag links. Maximum of 200 items. Provide an empty list to remove all links. Omit to leave unchanged. Since v67.0. |

### ClassificationCreateInputRepresentation

Represents the input for creating a data governance classification.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Description of the classification. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | string |  | Fully-qualified API name of the classification in dotted path format. Use 2-3 segments: `<TaxonomyName>.<Level1>[.<Level2>]`. Since v67.0. |
| `label` | `label` | string |  | Display label of the classification. Since v67.0. |
| `tag_fully_qualified_names` | `tagFullyQualifiedNames` | array of string |  | Fully-qualified API names of tags to associate with the classification. Maximum of 200 items. Since v67.0. |

### ConditionGroupInputRepresentation

Recursive group of conditions joined by AND or OR.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `operands` | `operands` | array of [ConditionNodeInput](#conditionnodeinputrepresentation) |  | Operands joined by the operator. Each operand is either a nested group or a leaf condition. Required. Since v67.0. |
| `operator` | `operator` | string |  | Logical operator joining the operands (AND or OR). Required. Since v67.0. |

### ConditionLeafInputRepresentation

Leaf condition within an AccessPolicy clause tree.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `clause` | `clause` | enum(WHEN, UNLESS) |  | Which clause of the rule this condition belongs to. Since v67.0. |
| `context_path` | `contextPath` | enum(SESSION_DATASPACE, SESSION_CONSUMER_ID, CONTEXT_AGENT_ID, CONTEXT_AGENT_VERSION_ID) |  | Context-side path the condition tests. Mutually exclusive with principal_path / resource_path. Since v67.0. |
| `id` | `id` | string |  | 18-character record ID of the underlying PolicyRuleDefinitionCond. Optional on create; required on update. Since v67.0. |
| `operator` | `operator` | enum(EQUALS, NOT_EQUALS, GREATER_THAN, LESS_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN_OR_EQUALS, IN, LIKE, CONTAINS_ANY, CONTAINS_NONE, CONTAINS_ALL, IS, EXISTS, HIERARCHICALLY_ABOVE, HIERARCHICALLY_BELOW, CONTAINS, STARTS_WITH, ENDS_WITH) |  | Comparison operator applied to the selected condition path. Valid operators depend on the selected path and value type. Required. Since v67.0. |
| `principal_path` | `principalPath` | enum(IS_AUTHENTICATED, ASSIGNED_PERMISSIONS_PATH, USER_ID, ORGANIZATION_ID, USER_ROLE_ID, RBAC_TAGS, SCALAR_ATTRIBUTE, PLURAL_ATTRIBUTE, PLACEHOLDER, IS_INTERNAL, CONTACT_ID) |  | Principal-side path the condition tests. Mutually exclusive with resource_path / context_path. Since v67.0. |
| `resource_expression` | `resourceExpression` | [ResourceExpressionInput](#resourceexpressioninputrepresentation) |  | Projection or join expression that relates the resource-side row to another object. Mutually exclusive with values and value_principal_path. Since v67.0. |
| `resource_path` | `resourcePath` | enum(NAMESPACE, ENTITY, RESOURCE, FIELD, ENTITYTYPE, ENTITYKIND, FIELDKIND, DATASPACE, TAG, SYSTEMTAG, OBJECT_TAG, CLASSIFICATION, IMPLICITTAG, OBJECT_SYSTEMTAG, RECORDFIELD, OBJECT_CLASSIFICATION, EXPRESSION, OBJECT_DATASPACE, RECORDFIELDTYPE, METADATAKIND, OBJECT) |  | Resource-side path the condition tests. Mutually exclusive with principal_path / context_path. Since v67.0. |
| `value_domain` | `valueDomain` | string |  | Optional value-domain qualifier scoping the comparison. Since v67.0. |
| `value_principal_path` | `valuePrincipalPath` | enum(IS_AUTHENTICATED, ASSIGNED_PERMISSIONS_PATH, USER_ID, ORGANIZATION_ID, USER_ROLE_ID, RBAC_TAGS, SCALAR_ATTRIBUTE, PLURAL_ATTRIBUTE, PLACEHOLDER, IS_INTERNAL, CONTACT_ID) |  | Right-side dynamic value pulled from the current principal. Mutually exclusive with values and resource_expression. Since v67.0. |
| `values` | `values` | array of [PolicyValueInput](#policyvalueinputrepresentation) |  | Typed values the operator compares against. Mutually exclusive with value_principal_path and resource_expression. Since v67.0. |

### ConditionNodeInputRepresentation

Node in a recursive AccessPolicy condition tree (group or condition). Exactly one of group or condition must be provided.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `condition` | `condition` | [ConditionLeafInput](#conditionleafinputrepresentation) |  | Leaf condition at this node. Provide either condition or group, but not both. Since v67.0. |
| `group` | `group` | [ConditionGroupInput](#conditiongroupinputrepresentation) |  | Nested condition group at this node. Provide either group or condition, but not both. Since v67.0. |

### PolicyValueInputRepresentation

A single typed value within an AccessPolicy condition's value set. Exactly one of the typed value fields (or the reference pair) must be provided.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `boolean_value` | `booleanValue` | boolean |  | Boolean-typed value (mutually exclusive with the other typed value fields). Since v67.0. |
| `date_time_value` | `dateTimeValue` | string (date-time) |  | DateTime-typed value (UTC instant, mutually exclusive with the other typed value fields). Since v67.0. |
| `date_value` | `dateValue` | string (date-time) |  | Date-typed value (UTC calendar day, mutually exclusive with the other typed value fields). Since v67.0. |
| `number_value` | `numberValue` | string |  | Number-typed value, string-encoded to preserve BigDecimal precision. Mutually exclusive with the other typed value fields. Since v67.0. |
| `percent_value` | `percentValue` | string |  | Percent-typed value, string-encoded to preserve BigDecimal precision. Mutually exclusive with the other typed value fields. Since v67.0. |
| `reference` | `reference` | string |  | Reference value (for example, a tag, classification, or custom permission API name). Paired with reference_type. Orthogonal to the typed value fields. Since v67.0. |
| `reference_type` | `referenceType` | string |  | Type discriminator for the reference field (for example, STANDARD_TAG, CUSTOM_TAG, STANDARD_CLASSIFICATION, CUSTOM_PERMISSION). Since v67.0. |
| `text_value` | `textValue` | string |  | Plain-text value. Mutually exclusive with the other typed value fields. Since v67.0. |

### ResourceExpressionInputRepresentation

Projection/join expression for an RLS-with-joins condition (EXISTS operator).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `projection` | `projection` | [ResourceExpressionJoinInput](#resourceexpressionjoininputrepresentation) |  | Join definition of the projection, specifying the joined object, its alias, and the join predicate. Since v67.0. |
| `type` | `type` | string |  | Expression type — always PROJECTION for join-based RLS. Required. Since v67.0. |
| `version` | `version` | integer |  | Schema version of the expression body. Since v67.0. |

### ResourceExpressionJoinInputRepresentation

A single join within an AccessPolicy resource-expression projection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `alias` | `alias` | string |  | Alias used to qualify the joined relation in the predicate, for example `individual`. Required. Since v67.0. |
| `predicate` | `predicate` | [ResourceExpressionPredicateInput](#resourceexpressionpredicateinputrepresentation) |  | Join predicate that specifies how a row in the joined object relates to the resource-side row. Since v67.0. |
| `schema` | `schema` | string |  | Joined Data Model Object or object API name, for example `Individual__dlm`. This is a name, not a record ID. Required. Since v67.0. |

### ResourceExpressionPredicateInputRepresentation

Represents the join predicate of an AccessPolicy resource-expression projection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `predicate` | `predicate` | string | yes | Join predicate definition, as a JSON expression that relates a row in the joined object to the resource-side row. Since v67.0. |

### ResourceTransformArgumentInputRepresentation

A static argument to an AccessPolicy rule's resource transform. Value is always string-encoded regardless of type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Argument type discriminator (STRING, NUMBER, BOOLEAN). Required. Since v67.0. |
| `value` | `value` | string |  | Argument value, string-encoded regardless of type. Required. Since v67.0. |

### TagAssignmentTargetInputRepresentation

Represents a target object and optional field for a tag assignment.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string |  | API name of the field. Requires `object_name`. Since v67.0. |
| `object_name` | `objectName` | string |  | API name of the data object. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | string |  | Not in the spec schema: from the spec's examples. |
| `targets` | `targets` | array of [TagAssignmentTargetInput_targets](#tagassignmenttargetinput_targets) |  | Not in the spec schema: from the spec's examples. |

### TagAssignmentTargetInput_targets

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `object_name` | `objectName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### TagBulkUpdateItemInputRepresentation

Represents the input for a single tag item in a bulk update operation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `classification_fully_qualified_names` | `classificationFullyQualifiedNames` | array of string |  | Replaces all classification links. Maximum of 200 items. Provide an empty list to remove all links. Omit to leave unchanged. Since v67.0. |
| `description` | `description` | string |  | Updated description. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | string |  | Fully-qualified API name of the tag to update. Since v67.0. |
| `label` | `label` | string |  | Updated display label. Since v67.0. |
| `parent_tag_fully_qualified_name` | `parentTagFullyQualifiedName` | string |  | Fully-qualified API name of the new parent tag. Provide `null` to move the tag to the root level. Must be in the same taxonomy. Since v67.0. |

### TagCreateInputRepresentation

Represents the input for creating a data governance tag.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `classification_fully_qualified_names` | `classificationFullyQualifiedNames` | array of string |  | Fully-qualified API names of classifications to associate with the tag. Maximum of 200 items. Since v67.0. |
| `description` | `description` | string |  | Description of the tag. Since v67.0. |
| `fully_qualified_name` | `fullyQualifiedName` | string |  | Fully-qualified API name of the tag in dotted path format. Use 2-3 segments: `<TaxonomyName>.<Level1>[.<Level2>]`. Since v67.0. |
| `label` | `label` | string |  | Display label of the tag. Since v67.0. |

### TagDetectionInstructionBulkCreateItemRepresentation

Represents a single tag's detection instruction in a bulk create request.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `instruction_txt` | `instructionTxt` | string | yes | LLM detection-instruction (prompt) body that defines how the tag is auto-detected. Maximum 100 characters. Since v67.0. |
| `tag_fully_qualified_name` | `tagFullyQualifiedName` | string | yes | Fully-qualified API name of the tag the instruction applies to (dotted path). Since v67.0. |

### TaxonomyBulkUpdateItemInputRepresentation

Represents the input for a single tag taxonomy update in a bulk update.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Updated description of the taxonomy. Since v67.0. |
| `label` | `label` | string |  | Updated label of the taxonomy. Since v67.0. |
| `name` | `name` | string |  | Developer name of the taxonomy to update. Since v67.0. |

### TaxonomyCreateInputRepresentation

Represents the input for creating a tag taxonomy.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Description of the taxonomy. Since v67.0. |
| `label` | `label` | string |  | Label of the taxonomy. Must be unique. Since v67.0. |
| `name` | `name` | string |  | Developer name of the taxonomy, with no `.`. A managed-package namespace prefix is allowed. Since v67.0. |
