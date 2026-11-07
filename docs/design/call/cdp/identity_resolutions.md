# Identity Resolutions

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Identity resolution merges records of the same person or account from different sources into one unified profile. A ruleset has two parts. Match rules decide which records belong together. Reconciliation rules decide which value wins on the unified profile.

Rulesets sit between mappings and everything that reads unified data. [Mapping must be complete before you create one](https://developer.salesforce.com/blogs/2024/10/data-cloud-and-identity-resolution), and [calculated insights and segments refresh after it](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md). The order is: map DLOs to DMOs, `ir_create`, `ir_run`, then poll `ir_get`.

The traps:

- `ruleset_id` [can't be changed](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules) and shapes the names of the generated DMOs, so choose it before creating.
- Wait on `last_job_status`, not `ruleset_status`. Ignore `last_job_completed` while a run is active, because it still shows the previous run.
- `ir_run` can return HTTP 200 without starting anything. Read `result_code`.
- A run took [about 15 minutes in one org](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md), and a community CLI warns that runs cost credits (community).
- The sources disagree on enum casing. See [`ir_create`](#ir_create).

```sql
CALL cdp.ir_create (label => 'Email Match', configuration_type => 'Individual', ruleset_id => 'mail',
  match_rules => [(label = 'Normalized Email', criteria = [(entity_name = 'ssot__ContactPointEmail__dlm', field_name = 'ssot__EmailAddress__c', match_method_type = 'exactnormalized', should_match_on_blank = false)])],
  reconciliation_rules => [(entity_name = 'ssot__Individual__dlm', rule_type = 'lastupdated', should_ignore_empty_value = true)]);
CALL cdp.ir_run (identity_resolution => '1irfj000000IWhWAAW');
CALL cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
```

**Functions:** [`ir_delete`](#ir_delete), [`ir_list`](#ir_list), [`ir_get`](#ir_get), [`ir_update`](#ir_update), [`ir_create`](#ir_create), [`ir_run`](#ir_run), [`ir_publish`](#ir_publish)

## ir_delete

`DELETE /ssot/identity-resolutions/{identityResolution}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Identity-Resolutions/paths/~1ssot~1identity-resolutions~1%7BidentityResolution%7D/delete) · tool `d360_ir_delete` · evidence O · changes org state

Delete an identity resolution ruleset in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `identity_resolution` | `identityResolution` | path | string | yes | Developer name or ID of the ruleset (spec). Use `id`: see [`ir_get`](#ir_get). |

```sql
CALL cdp.ir_delete (identity_resolution => '1irfj000000IWhWAAW');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** Use the `id` from `ir_list`: see [`ir_get`](#ir_get). `ruleset_status` has `DELETING` and `DELETE_FAILED`, which suggests a 204 may not mean the delete finished, but no source describes it. The [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/IdentityResolutionTools.java) only warns that "active resolutions may be affected". Nothing lists what happens to the generated DMOs or to the insights and segments that read them, so check those first.

## ir_list

`GET /ssot/identity-resolutions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Identity-Resolutions/paths/~1ssot~1identity-resolutions/get) · tool `d360_ir_list` · evidence O · read-only

Get identity resolution rulesets in Data 360. Since v57.0.

**Options**

None.

```sql
CALL cdp.ir_list ();
```

**Result**

One row per item of `/identityResolutions` in the response. Schema `CdpIdentityResolutionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `anonymous_unified_profiles` | `anonymousUnifiedProfiles` | BIGINT | Count of anonymous unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `configuration_type` | `configurationType` | VARCHAR | Source object for an identity resolution. Since v57.0. |
| `consolidation_rate` | `consolidationRate` | DOUBLE | Consolidation rate resulting from the run of an identity resolution ruleset. Since v57.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space used as source data for an identity resolution ruleset. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the identity resolution ruleset. Since v57.0. |
| `does_run_automatically` | `doesRunAutomatically` | BOOLEAN | Specifies whether automatic job run scheduling is enabled for the ruleset (`true`) or not (`false`). If unspecified, defaults to `false`. Since v57.0. |
| `id` | `id` | VARCHAR | Identity resolution ruleset's ID. This is not the identity resolution's extended ruleset ID (`ruleset_id`). Since v57.0. |
| `known_unified_profiles` | `knownUnifiedProfiles` | BIGINT | Count of known unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `label` | `label` | VARCHAR | User friendly name of the identity resolution ruleset. Since v57.0. |
| `last_job_completed` | `lastJobCompleted` | VARCHAR | Date and time the last job completed. Since v57.0. |
| `last_job_status` | `lastJobStatus` | VARCHAR | Last job's status. Possible values are: - `SUCCESS` - `IN_PROGRESS` - `FAIL` - `SCHEDULED` - `SKIPPED` Since v57.0. |
| `match_rules` | `matchRules` | JSON (array of CdpIdentityResolutionMatchRuleOutput) | List of match rules. Since v57.0. |
| `matched_source_profiles` | `matchedSourceProfiles` | BIGINT | Count of matched source profiles identified by running the identity resolution ruleset. Since v57.0. |
| `object_api_name` | `objectApiName` | VARCHAR | Object name of the identity resolution ruleset. Since v57.0. |
| `reconciliation_rules` | `reconciliationRules` | JSON (array of CdpIdentityResolutionReconciliationRuleOutput) | List of reconciliation rules. Since v57.0. |
| `ruleset_id` | `rulesetId` | VARCHAR | Extension ID of a ruleset. The ruleset ID must be unique and no longer than 4 characters. This ID is not the identifying ID for the ruleset. Since v57.0. |
| `ruleset_status` | `rulesetStatus` | VARCHAR | Status of a ruleset job. Possible values are: - `NEW` - `PUBLISHING` - `PUBLISHED` - `ERROR` - `DELETING` - `DELETE_FAILED` Since v57.0. |
| `source_profiles` | `sourceProfiles` | BIGINT | Count of source profiles that were processed by a ruleset job. Since v57.0. |
| `total_unified_profiles` | `totalUnifiedProfiles` | BIGINT | Count of unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `secondary_dmo` | `secondaryDmo` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** Each row has the full rules, [so one call is enough](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community). There's no data space filter, so [filter on `dataspace_name` yourself](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community). Rulesets [have no developer name](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community), so find one by `label` and use its `id`. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/IdentityResolutionTools.java) sends an optional `filter_group` query parameter that the spec doesn't list.

## ir_get

`GET /ssot/identity-resolutions/{identityResolution}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Identity-Resolutions/paths/~1ssot~1identity-resolutions~1%7BidentityResolution%7D/get) · tool `d360_ir_get` · evidence O · read-only

Get an identity resolution ruleset in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `identity_resolution` | `identityResolution` | path | string | yes | Developer name or ID of the ruleset (spec). Use `id`, see the notes. |

```sql
CALL cdp.ir_get (identity_resolution => '1irfj000000IWhWAAW');
```

**Result**

One row. Schema `CdpIdentityResolutionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `anonymous_unified_profiles` | `anonymousUnifiedProfiles` | BIGINT | Count of anonymous unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `configuration_type` | `configurationType` | VARCHAR | Source object for an identity resolution. Since v57.0. |
| `consolidation_rate` | `consolidationRate` | DOUBLE | Consolidation rate resulting from the run of an identity resolution ruleset. Since v57.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space used as source data for an identity resolution ruleset. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the identity resolution ruleset. Since v57.0. |
| `does_run_automatically` | `doesRunAutomatically` | BOOLEAN | Specifies whether automatic job run scheduling is enabled for the ruleset (`true`) or not (`false`). If unspecified, defaults to `false`. Since v57.0. |
| `id` | `id` | VARCHAR | Identity resolution ruleset's ID. This is not the identity resolution's extended ruleset ID (`ruleset_id`). Since v57.0. |
| `known_unified_profiles` | `knownUnifiedProfiles` | BIGINT | Count of known unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `label` | `label` | VARCHAR | User friendly name of the identity resolution ruleset. Since v57.0. |
| `last_job_completed` | `lastJobCompleted` | VARCHAR | Date and time the last job completed. Since v57.0. |
| `last_job_status` | `lastJobStatus` | VARCHAR | Last job's status. Possible values are: - `SUCCESS` - `IN_PROGRESS` - `FAIL` - `SCHEDULED` - `SKIPPED` Since v57.0. |
| `match_rules` | `matchRules` | JSON (array of CdpIdentityResolutionMatchRuleOutput) | List of match rules. Since v57.0. |
| `matched_source_profiles` | `matchedSourceProfiles` | BIGINT | Count of matched source profiles identified by running the identity resolution ruleset. Since v57.0. |
| `object_api_name` | `objectApiName` | VARCHAR | Object name of the identity resolution ruleset. Since v57.0. |
| `reconciliation_rules` | `reconciliationRules` | JSON (array of CdpIdentityResolutionReconciliationRuleOutput) | List of reconciliation rules. Since v57.0. |
| `ruleset_id` | `rulesetId` | VARCHAR | Extension ID of a ruleset. The ruleset ID must be unique and no longer than 4 characters. This ID is not the identifying ID for the ruleset. Since v57.0. |
| `ruleset_status` | `rulesetStatus` | VARCHAR | Status of a ruleset job. Possible values are: - `NEW` - `PUBLISHING` - `PUBLISHED` - `ERROR` - `DELETING` - `DELETE_FAILED` Since v57.0. |
| `source_profiles` | `sourceProfiles` | BIGINT | Count of source profiles that were processed by a ruleset job. Since v57.0. |
| `total_unified_profiles` | `totalUnifiedProfiles` | BIGINT | Count of unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `secondary_dmo` | `secondaryDmo` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** **Which field to read.** The [retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) checked these against one org on 2026-06-10:

| Field | Use it for | Trap |
|---|---|---|
| `last_job_status` | Whether the current run finished. The only field to wait on. | The spec lists `FAIL`, and the kit observed `FAILED` (one org). Treat both as failure. Values are uppercase there, and Title Case comparisons "will silently never match". |
| `ruleset_status` | Whether the definition is published | The spec calls it the "status of a ruleset job", but the kit says it's "NOT a per-run status". |
| `last_job_completed` | When an earlier run ended | Stale during a run: it "reflects the PREVIOUS completed run". Don't compare it to now. |

**Generated DMOs:** `reconciliation_rules[].unifiedDmoName` and `linkDmoName` are the real table names to query. See [`ir_create`](#ir_create).

**Id or name:** the spec says the path takes the "developer name or ID", and the [Marketing Cloud guide](https://developer.salesforce.com/docs/marketing/marketing-cloud-growth/guide/mc-manage-identity-resolution-run-now.md) calls it the ruleset name. But responses [have no developer name](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community), and an SDK says [every item call needs the `id`](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/identity-resolutions.ts) (community). Use `id` from `ir_list`, for example `1irfj000000IWhWAAW`. It isn't `ruleset_id`.

**Fields beyond the spec:** `ruleset_id` is missing from the spec's `ir_get` example and a [live fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/identity-resolution-get.json) (community), so expect `NULL`. That fixture also returns `secondaryDmo`, `filters` and `isCaseSensitive`, which the spec's schema doesn't list, so they land in `_raw`. It shows `consolidation_rate` 75 with 8 source profiles and 2 unified profiles, so the value looks like a percentage (community, one org). `object_api_name` is [the name without a suffix](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), such as `Individual` (community).

## ir_update

`PATCH /ssot/identity-resolutions/{identityResolution}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Identity-Resolutions/paths/~1ssot~1identity-resolutions~1%7BidentityResolution%7D/patch) · tool `d360_ir_update`, `d360_ir_full_update` · evidence O · changes org state

Update an identity resolution ruleset in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `identity_resolution` | `identityResolution` | path | string | yes | Developer name or ID of the ruleset (spec). Use `id`: see [`ir_get`](#ir_get). |
| `description` | `description` | body | string |  | Description of the identity resolution ruleset. Since v57.0. |
| `does_run_automatically` | `doesRunAutomatically` | body | boolean |  | Specifies whether automatic job run scheduling is enabled for the ruleset (`true`) or not (`false`). If unspecified, defaults to `false`. Since v57.0. |
| `label` | `label` | body | string | yes | User friendly name of the identity resolution ruleset. Since v57.0. |
| `match_rules` | `matchRules` | body | array of [CdpIdentityResolutionConfigPatchInput_matchRules](#cdpidentityresolutionconfigpatchinput_matchrules) |  | List of match rules for the identity resolution ruleset. Since v57.0. |
| `reconciliation_rules` | `reconciliationRules` | body | array of [CdpIdentityResolutionConfigPatchInput_reconciliationRules](#cdpidentityresolutionconfigpatchinput_reconciliationrules) | yes | List of reconciliation rules for the identity resolution ruleset. Since v57.0. |
| `configuration_type` | `configurationType` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `ruleset_id` | `rulesetId` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.ir_update (identity_resolution => '1irfj000000IWhWAAW', label => 'Customer Match', does_run_automatically => true, reconciliation_rules => [(entity_name = 'ssot__Individual__dlm', rule_type = 'lastupdated', should_ignore_empty_value = true), (entity_name = 'ssot__ContactPointEmail__dlm', rule_type = 'mostfrequent', should_ignore_empty_value = true)]);
```

**Result**

One row. Schema `CdpIdentityResolutionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `anonymous_unified_profiles` | `anonymousUnifiedProfiles` | BIGINT | Count of anonymous unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `configuration_type` | `configurationType` | VARCHAR | Source object for an identity resolution. Since v57.0. |
| `consolidation_rate` | `consolidationRate` | DOUBLE | Consolidation rate resulting from the run of an identity resolution ruleset. Since v57.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space used as source data for an identity resolution ruleset. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the identity resolution ruleset. Since v57.0. |
| `does_run_automatically` | `doesRunAutomatically` | BOOLEAN | Specifies whether automatic job run scheduling is enabled for the ruleset (`true`) or not (`false`). If unspecified, defaults to `false`. Since v57.0. |
| `id` | `id` | VARCHAR | Identity resolution ruleset's ID. This is not the identity resolution's extended ruleset ID (`ruleset_id`). Since v57.0. |
| `known_unified_profiles` | `knownUnifiedProfiles` | BIGINT | Count of known unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `label` | `label` | VARCHAR | User friendly name of the identity resolution ruleset. Since v57.0. |
| `last_job_completed` | `lastJobCompleted` | VARCHAR | Date and time the last job completed. Since v57.0. |
| `last_job_status` | `lastJobStatus` | VARCHAR | Last job's status. Possible values are: - `SUCCESS` - `IN_PROGRESS` - `FAIL` - `SCHEDULED` - `SKIPPED` Since v57.0. |
| `match_rules` | `matchRules` | JSON (array of CdpIdentityResolutionMatchRuleOutput) | List of match rules. Since v57.0. |
| `matched_source_profiles` | `matchedSourceProfiles` | BIGINT | Count of matched source profiles identified by running the identity resolution ruleset. Since v57.0. |
| `object_api_name` | `objectApiName` | VARCHAR | Object name of the identity resolution ruleset. Since v57.0. |
| `reconciliation_rules` | `reconciliationRules` | JSON (array of CdpIdentityResolutionReconciliationRuleOutput) | List of reconciliation rules. Since v57.0. |
| `ruleset_id` | `rulesetId` | VARCHAR | Extension ID of a ruleset. The ruleset ID must be unique and no longer than 4 characters. This ID is not the identifying ID for the ruleset. Since v57.0. |
| `ruleset_status` | `rulesetStatus` | VARCHAR | Status of a ruleset job. Possible values are: - `NEW` - `PUBLISHING` - `PUBLISHED` - `ERROR` - `DELETING` - `DELETE_FAILED` Since v57.0. |
| `source_profiles` | `sourceProfiles` | BIGINT | Count of source profiles that were processed by a ruleset job. Since v57.0. |
| `total_unified_profiles` | `totalUnifiedProfiles` | BIGINT | Count of unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `secondary_dmo` | `secondaryDmo` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** The spec requires `label` and `reconciliation_rules`. The [MCP server's request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/identityresolution/IdentityResolutionPatchRequest.java) makes everything optional and calls this a "partial" update, and it also accepts `ruleset_id` and `configuration_type`, which the spec's body doesn't have. Follow the spec and send both required fields. No source says whether omitting `match_rules` keeps the existing ones.

`ruleset_id` [can't be changed](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules). Rule changes don't take effect at once: the [MCP catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "changes apply after republish", and [Trailhead](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules) says changes are "processed on a daily basis". See [`ir_create`](#ir_create) for rule attributes and casing.

## ir_create

`POST /ssot/identity-resolutions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Identity-Resolutions/paths/~1ssot~1identity-resolutions/post) · tool `d360_ir_create` · evidence O · changes org state

Create an identity resolution ruleset in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configuration_type` | `configurationType` | body | enum(Account, Individual) | yes | Source object for an identity resolution ruleset. |
| `description` | `description` | body | string |  | Description of the identity resolution ruleset. Since v57.0. |
| `does_run_automatically` | `doesRunAutomatically` | body | boolean |  | Specifies whether automatic job run scheduling is enabled for the ruleset (`true`) or not (`false`). If unspecified, defaults to `false`. Since v57.0. |
| `label` | `label` | body | string | yes | User friendly name of the identity resolution ruleset. Since v57.0. |
| `match_rules` | `matchRules` | body | array of [CdpIdentityResolutionConfigInput_matchRules](#cdpidentityresolutionconfiginput_matchrules) |  | List of match rules for the identity resolution ruleset. Since v57.0. |
| `reconciliation_rules` | `reconciliationRules` | body | array of [CdpIdentityResolutionConfigInput_reconciliationRules](#cdpidentityresolutionconfiginput_reconciliationrules) | yes | List of reconciliation rules for the identity resolution ruleset. Since v57.0. |
| `ruleset_id` | `rulesetId` | body | string |  | Extended ID of the ruleset used to differentiate between rulesets created for comparison. The ruleset ID must be unique and can't be longer than 4 characters. Since v57.0. |

```sql
CALL cdp.ir_create (
  label => 'Customer Match',
  description => 'Email, or name plus phone, or device serial number',
  configuration_type => 'Individual',
  ruleset_id => 'cust',
  does_run_automatically => false,
  /* Criteria in one rule are ANDed. Rules are ORed. */
  match_rules => [
    (label = 'Normalized Email', criteria = [
      (entity_name = 'ssot__ContactPointEmail__dlm', field_name = 'ssot__EmailAddress__c', match_method_type = 'exactnormalized', should_match_on_blank = false)
    ]),
    (label = 'Fuzzy Name and Normalized Phone', criteria = [
      (entity_name = 'ssot__Individual__dlm', field_name = 'ssot__FirstName__c', match_method_type = 'fuzzy', should_match_on_blank = false),
      (entity_name = 'ssot__Individual__dlm', field_name = 'ssot__LastName__c', match_method_type = 'exact', should_match_on_blank = false),
      (entity_name = 'ssot__ContactPointPhone__dlm', field_name = 'ssot__FormattedE164PhoneNumber__c', match_method_type = 'exactnormalized', should_match_on_blank = false)
    ]),
    (label = 'Device Serial Number', criteria = [
      (entity_name = 'ssot__PartyIdentification__dlm', field_name = 'ssot__IdentificationNumber__c', match_method_type = 'exact', case_sensitive_match = false, should_match_on_blank = false,
       party_identification_info = (party_name = 'Pacemaker Serial Number', partyType = 'Device Identifier'))
    ])
  ],
  /* A default rule per DMO, with one field overriding it. */
  reconciliation_rules => [
    (entity_name = 'ssot__Individual__dlm', rule_type = 'lastupdated', should_ignore_empty_value = true, fields = [
      (field_name = 'ssot__Id__c', rule_type = 'sourcesequence', should_ignore_empty_value = true, sources = [(name = 'Contact_Home__dll'), (name = 'Lead_Home__dll')])
    ]),
    (entity_name = 'ssot__ContactPointEmail__dlm', rule_type = 'mostfrequent', should_ignore_empty_value = true),
    (entity_name = 'ssot__ContactPointPhone__dlm', rule_type = 'sourcesequence', should_ignore_empty_value = true, sources = [(name = 'Contact_Home__dll'), (name = 'Lead_Home__dll')]),
    (entity_name = 'ssot__PartyIdentification__dlm', rule_type = 'mostfrequent', should_ignore_empty_value = true)
  ]
);
```

**Result**

One row. Schema `CdpIdentityResolutionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `anonymous_unified_profiles` | `anonymousUnifiedProfiles` | BIGINT | Count of anonymous unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `configuration_type` | `configurationType` | VARCHAR | Source object for an identity resolution. Since v57.0. |
| `consolidation_rate` | `consolidationRate` | DOUBLE | Consolidation rate resulting from the run of an identity resolution ruleset. Since v57.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space used as source data for an identity resolution ruleset. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the identity resolution ruleset. Since v57.0. |
| `does_run_automatically` | `doesRunAutomatically` | BOOLEAN | Specifies whether automatic job run scheduling is enabled for the ruleset (`true`) or not (`false`). If unspecified, defaults to `false`. Since v57.0. |
| `id` | `id` | VARCHAR | Identity resolution ruleset's ID. This is not the identity resolution's extended ruleset ID (`ruleset_id`). Since v57.0. |
| `known_unified_profiles` | `knownUnifiedProfiles` | BIGINT | Count of known unified profiles created by running the identity resolution ruleset. Since v57.0. |
| `label` | `label` | VARCHAR | User friendly name of the identity resolution ruleset. Since v57.0. |
| `last_job_completed` | `lastJobCompleted` | VARCHAR | Date and time the last job completed. Since v57.0. |
| `last_job_status` | `lastJobStatus` | VARCHAR | Last job's status. Possible values are: - `SUCCESS` - `IN_PROGRESS` - `FAIL` - `SCHEDULED` - `SKIPPED` Since v57.0. |
| `match_rules` | `matchRules` | JSON (array of CdpIdentityResolutionMatchRuleOutput) | List of match rules. Since v57.0. |
| `matched_source_profiles` | `matchedSourceProfiles` | BIGINT | Count of matched source profiles identified by running the identity resolution ruleset. Since v57.0. |
| `object_api_name` | `objectApiName` | VARCHAR | Object name of the identity resolution ruleset. Since v57.0. |
| `reconciliation_rules` | `reconciliationRules` | JSON (array of CdpIdentityResolutionReconciliationRuleOutput) | List of reconciliation rules. Since v57.0. |
| `ruleset_id` | `rulesetId` | VARCHAR | Extension ID of a ruleset. The ruleset ID must be unique and no longer than 4 characters. This ID is not the identifying ID for the ruleset. Since v57.0. |
| `ruleset_status` | `rulesetStatus` | VARCHAR | Status of a ruleset job. Possible values are: - `NEW` - `PUBLISHING` - `PUBLISHED` - `ERROR` - `DELETING` - `DELETE_FAILED` Since v57.0. |
| `source_profiles` | `sourceProfiles` | BIGINT | Count of source profiles that were processed by a ruleset job. Since v57.0. |
| `total_unified_profiles` | `totalUnifiedProfiles` | BIGINT | Count of unified profiles created by running the identity resolution ruleset. Since v57.0. |

**Notes:** Create this only after DLOs are mapped to DMOs. Salesforce says [mapping "must be completed before creating your rulesets"](https://developer.salesforce.com/blogs/2024/10/data-cloud-and-identity-resolution), and [Trailhead](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules) and the [MCP catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) say the same. A community skill warns to [run only "after mappings are trustworthy"](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-harmonize/SKILL.md) (community). Trailhead also allows ["up to two" rulesets](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules).

**`ruleset_id`:** optional, up to 4 characters, unique, and [can't be changed once set](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules). It shapes the generated DMO names, which is why changing your mind later is expensive:

| Ruleset | `unifiedDmoName` | `linkDmoName` | Source |
|---|---|---|---|
| `ruleset_id` `prod` | `UnifiedssotIndividualProd__dlm` | `UnifiedLinkssotIndividualProd__dlm` | [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/ps-datacloud/main/default/dataKitObjectTemplates/Individual_prod29.dataKitObjectTemplate-meta.xml) |
| no `ruleset_id` in the response | `UnifiedIndividual__dlm` | `IndividualIdentityLink__dlm` | spec example for `ir_get` |

The [query docs](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-metadata.md) show `UnifiedssotIndividualIr1__dlm` too. No source states the naming rule, so read the names from `reconciliation_rules` in `ir_get` instead of composing them. They are `null` with `ruleset_status` `NEW` in the spec's create response example. [Unified DMO names "are ruleset-specific"](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-harmonize/SKILL.md) (community), so SQL written against one ruleset's names doesn't carry to another.

The MCP server describes `ruleset_id` differently, as ["Ruleset ID to base this on"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/identityresolution/IdentityResolutionPatchRequest.java). The spec calls it an extended id that tells rulesets apart, which fits the kit's names.

**Match rules:** criteria inside a rule are ANDed and rules are ORed, as in [Trailhead's example](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules). The [MCP catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) adds that "rules execute in priority order". `match_rules` is optional in the spec.

| Attribute of `match_rules` | Meaning |
|---|---|
| `label` | Rule name |
| `criteria[].entityName`, `field_name` | DMO and field compared |
| `criteria[].matchMethodType` | See casing below |
| `criteria[].shouldMatchOnBlank` | Whether blank fields can match |
| `criteria[].caseSensitiveMatch` | Spec: only for party identifier matching, though the spec's own update example sets it everywhere |
| `criteria[].partyIdentificationInfo` | `party_name` and `partyType`. The example's values come from the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/ps-datacloud/main/default/dataKitObjectTemplates/Individual_prod29.dataKitObjectTemplate-meta.xml) |

**Reconciliation rules:** one default per DMO, with `fields` overriding it per field.

| Attribute of `reconciliation_rules` | Meaning |
|---|---|
| `entity_name` | DMO the rule applies to |
| `rule_type` | Default rule. The [MCP payload](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) says omitting it "causes a server 500", although the spec's create example omits it on one rule |
| `should_ignore_empty_value` | Whether empty values are ignored |
| `sources[].name` | For `sourcesequence`: source DLOs in priority order |
| `fields[]` | `field_name`, `rule_type`, `should_ignore_empty_value`, `sources` |

For `lastupdated`, the [MCP payload](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) says the DMO needs `ssot__LastModifiedDate__c` mapped, and to use `sourcesequence` otherwise.

**Casing:** the sources disagree, and nothing here has been tested. The examples use the MCP form, which is also what `ir_get` responses show.

| Source | Match method | Rule type | `configuration_type` |
|---|---|---|---|
| Spec schemas | `ExactNormalized` | `LastUpdated` | `Individual` |
| Spec create example | `EXACT_NORMALIZED` | `LAST_UPDATED` | `Individual` |
| Spec update example, [MCP payload](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) | `exactnormalized` | `lastupdated` | `individual` (MCP) |
| `ir_get` responses (spec example, [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/identity-resolution-get.json)) | `exactnormalized` | `lastupdated` | `individual` |

The spec's create example also uses placeholder names such as `orgnamespace__*Individual*MyDataSpace__dlm`, which is why the example here doesn't. The spec has no option for the data space.

No source says whether create publishes the ruleset or starts a run: see [`ir_publish`](#ir_publish). On the UI path, unified profiles appear [within 24 hours of the first publish](https://trailhead.salesforce.com/content/learn/modules/data-and-identity-in-salesforce-cdp/configure-identity-resolution-rules).

## ir_run

`POST /ssot/identity-resolutions/{identityResolution}/actions/run-now` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Identity-Resolutions/paths/~1ssot~1identity-resolutions~1%7BidentityResolution%7D~1actions~1run-now/post) · tool `d360_ir_run` · evidence O · changes org state

Run an identity resolution ruleset job on demand in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `identity_resolution` | `identityResolution` | path | string | yes | Developer name or ID of the ruleset (spec). Use `id`: see [`ir_get`](#ir_get). |
| `calling_app` | `callingApp` | body | string |  | Calling application. Since v57.0. |
| `calling_app_info` | `callingAppInfo` | body | string |  | Calling application information. Since v57.0. |

```sql
CALL cdp.ir_run (identity_resolution => '1irfj000000IWhWAAW');
```

**Result**

One row. Schema `CdpIdentityResolutionRunNowOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `result_code` | `resultCode` | VARCHAR | Result of an identity resolution ruleset job run. Since v57.0. |

**Done when:** `ir_get.last_job_status` = `SUCCESS`. Failure is `FAIL` (spec) or `FAILED` (one org). The spec also lists `SKIPPED`. Compare in uppercase, and don't use `ruleset_status` or `last_job_completed`.

**Notes:** Read `result_code` first, because all four values arrive in a successful response. [Only one starts a run](https://developer.salesforce.com/docs/marketing/marketing-cloud-growth/guide/mc-manage-identity-resolution-run-now.md):

| `result_code` | What it means for polling |
|---|---|
| `SuccessfullySubmittedIdentityResolutionJobRunRequest` | A run was submitted. Poll. |
| `NoPendingChangesJobRunSkipped` | Nothing ran, so don't poll for a new result. No source says what `last_job_status` shows then, though the spec lists `SKIPPED`. |
| `IdentityResolutionJobIsAlreadyRunning` | Poll the run in progress. |
| `ExceededMaximumNumberOfSuccessfulRunsAllowedIn24Hours` | Nothing ran. Try again later. |

Salesforce's [throttling table](https://help.salesforce.com/apex/HTViewHelpDoc?id=data.c360_a_guidelines_and_limits_for_workflows.htm) gives the cap as 4 runs per 24 hours per ruleset, read only through a search excerpt.

No source says how soon `last_job_status` changes after a submit, so an early poll may still see the previous `SUCCESS`.

**Observed duration (one org):** the [retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) saw a run finish at minute 15 on 2026-06-10 and raised its ceiling from 15 to 20 minutes, polling every 60 s. Other orgs may differ. It retries `FAILED` up to 2 times, 30 s apart, and doesn't retry a timeout.

A community CLI calls this ["the costliest Data 360 operation"](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.identity-resolution.run.md) and warns about credits first (community). Run it after mappings are done, and before calculated insights and segments, [which the kit refreshes afterwards](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md). The kit sends an empty `{}` body. No source explains `calling_app` or `calling_app_info`.

## ir_publish

`POST /ssot/identity-resolutions/{id}/actions/publish` · tool `d360_ir_publish` · evidence S · changes org state

Publish a ruleset so identity resolution can use it. This call comes from Salesforce's MCP server and isn't in the spec.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `identity_resolution_id` | `id` | path | string | yes | The identity resolution ID |

```sql
CALL cdp.ir_publish (identity_resolution_id => '1irfj000000IWhWAAW');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Done when:** No source documents this. The spec's `ir_get.ruleset_status` values suggest `PUBLISHING`, then `PUBLISHED` or `ERROR`.

**Notes:** This endpoint is not in the spec or the [Postman-derived catalog](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json). It comes only from the [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/IdentityResolutionTools.java), which says it "activates ruleset for identity resolution". A [community CLI leaves it out](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) (community), and the [retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) never calls it. No source says when you need it, or whether `ir_create` publishes by itself. The [MCP catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) implies it's needed after `ir_update`: "changes apply after republish". The server's unit test mocks `{"status": "PUBLISHED"}`, which isn't evidence of the real response.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpIdentityResolutionConfigInput_matchRules

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `criteria` | `criteria` | array of [CdpIdentityResolutionConfigInput_matchRules_criteria](#cdpidentityresolutionconfiginput_matchrules_criteria) |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigInput_matchRules_criteria

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `entity_name` | `entityName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `match_method_type` | `matchMethodType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `should_match_on_blank` | `shouldMatchOnBlank` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `party_identification_info` | `partyIdentificationInfo` | [CdpIdentityResolutionConfigInput_matchRules_criteria_partyIdentificationInfo](#cdpidentityresolutionconfiginput_matchrules_criteria_partyidentificationinfo) |  | Seen in examples: the spec types the parent as a free-form object. |
| `case_sensitive_match` | `caseSensitiveMatch` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigInput_matchRules_criteria_partyIdentificationInfo

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `party_name` | `partyName` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigInput_reconciliationRules

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `entity_name` | `entityName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `rule_type` | `ruleType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `should_ignore_empty_value` | `shouldIgnoreEmptyValue` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `fields` | `fields` | array of [CdpIdentityResolutionConfigInput_reconciliationRules_fields](#cdpidentityresolutionconfiginput_reconciliationrules_fields) |  | Seen in examples: the spec types the parent as a free-form object. |
| `sources` | `sources` | array of [CdpIdentityResolutionConfigInput_reconciliationRules_sources](#cdpidentityresolutionconfiginput_reconciliationrules_sources) |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigInput_reconciliationRules_fields

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `rule_type` | `ruleType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `should_ignore_empty_value` | `shouldIgnoreEmptyValue` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `sources` | `sources` | array of [CdpIdentityResolutionConfigInput_reconciliationRules_fields_sources](#cdpidentityresolutionconfiginput_reconciliationrules_fields_sources) |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigInput_reconciliationRules_fields_sources

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigInput_reconciliationRules_sources

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigPatchInput_matchRules

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `criteria` | `criteria` | array of [CdpIdentityResolutionConfigPatchInput_matchRules_criteria](#cdpidentityresolutionconfigpatchinput_matchrules_criteria) |  | Seen in examples: the spec types the parent as a free-form object. |
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigPatchInput_matchRules_criteria

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `case_sensitive_match` | `caseSensitiveMatch` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `entity_name` | `entityName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `match_method_type` | `matchMethodType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `should_match_on_blank` | `shouldMatchOnBlank` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigPatchInput_reconciliationRules

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `entity_name` | `entityName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `fields` | `fields` | array of [CdpIdentityResolutionConfigPatchInput_reconciliationRules_fields](#cdpidentityresolutionconfigpatchinput_reconciliationrules_fields) |  | Seen in examples: the spec types the parent as a free-form object. |
| `rule_type` | `ruleType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `should_ignore_empty_value` | `shouldIgnoreEmptyValue` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `sources` | `sources` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigPatchInput_reconciliationRules_fields

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `rule_type` | `ruleType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `should_ignore_empty_value` | `shouldIgnoreEmptyValue` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `sources` | `sources` | array of [CdpIdentityResolutionConfigPatchInput_reconciliationRules_fields_sources](#cdpidentityresolutionconfigpatchinput_reconciliationrules_fields_sources) |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpIdentityResolutionConfigPatchInput_reconciliationRules_fields_sources

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
