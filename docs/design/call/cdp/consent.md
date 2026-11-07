# Consent

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

The Consent API records and reads a person's privacy requests against their Data 360 profile: stop processing their data, export it, or delete it. It's the core REST API at `/services/data/vXX.X/consent/action/{action}`, not a Connect API, so it's absent from the spec. The sources are the [Data 360 Consent page](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-cdp-params.md) and the general [read](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-action.md) and [write](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-write.md) pages.

The order is write, then read. A new profile has no consent data, so the docs say to PATCH before the first GET.

The gotchas that matter most:

- Without `mode => 'cdp'` the same path works on CRM records (Contact, Lead, Individual) instead of the Data 360 profile.
- A 200 response can still contain errors. Check the `result` column on every row.
- `shouldforget` takes `status => 'optin'`, and it permanently deletes PII.
- The sources don't say how long a request takes or how to tell it finished.

```sql
CALL cdp.consent_update (action => 'processing', ids => '100000695', mode => 'cdp', status => 'optout');
CALL cdp.consent_get (action => 'processing', ids => '100000695', mode => 'cdp');
```

**Functions:** [`consent_get`](#consent_get), [`consent_update`](#consent_update)

## consent_get

`GET /consent/action/{action}` · evidence D · host core · read-only

Reads the consent flag of one action for a list of Data 360 profiles. Use it to check whether a profile has restricted processing, asked for an export, or asked to be forgotten.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `action` | `action` | path | string | yes | `processing`, `portability` or `shouldforget`. |
| `ids` | `ids` | query | string | yes | Comma-separated list of IDs. Each must be present in a field mapped to Individual.Individual Id. |
| `mode` | `mode` | query | string |  | Send `cdp` to read the Data 360 profile. The API default is `normal`, which reads CRM consent records. |

```sql
CALL cdp.consent_get (action => 'portability', ids => '00932I3SU92', mode => 'cdp');
```

**Result**

One row per top-level key of the response, where each key is a requested ID. Nothing goes to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | The response key. |
| `result` | `result` | VARCHAR | `Success`, or an error message. |
| `proceed` | `proceed` | JSON | Object with `<action>` and `<action>Result`, such as `portability` and `portabilityResult`. The flag is the string `"true"` or `"false"`. |

**Notes:** A profile has no default consent data, so [PATCH it before the first GET](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-cdp-params.md). The docs point to [a troubleshooting article](https://help.salesforce.com/s/articleView?id=000397169&type=1), which couldn't be read for this reference, so what a GET returns before that is unknown.

Permissions disagree. The Data 360 page asks for ModifyAllData or ConsentApiUpdate. The [general read page](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-action.md) asks for View All Data or Allow User Access to Privacy Data.

Action names disagree too. The Data 360 page uses `processing` where the general read page uses `process`. The options above follow the Data 360 page.

The flag means different things per action on the general read page: `true` is opted in for `portability` and `shouldforget`, and not opted out for `process`.

The docs' read example returns the key `j00932I3SU92` for `ids=00932I3SU92`, so don't assume a key matches its ID until this is checked against an org.

`aggregatedConsent`, `datetime`, `policy`, `purpose` and `verbose` are left out. The general read page documents them for CRM consent, and the Data 360 page lists only `ids` and `mode`. The `explanation` array in the general response example comes from `verbose`, and no source shows it for `mode=cdp`.

## consent_update

`PATCH /consent/action/{action}` · evidence D · host core · changes org state

Records a consent request on Data 360 profiles: restrict processing, export the profile to your S3 bucket, or delete its PII. Use it to carry out a consumer rights request.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `action` | `action` | path | string | yes | `processing`, `portability` or `shouldforget`. |
| `ids` | `ids` | query | string | yes | Comma-separated list of IDs. Each is a string equal to the Individual ID attribute. |
| `mode` | `mode` | query | string |  | Send `cdp` to write to the Data 360 profile. The API default is `normal`, which writes CRM consent records. |
| `status` | `status` | query | string | yes | `optin` or `optout`. Use `optout` for `processing`, and `optin` for `portability` and `shouldforget`. |
| `aws_s3_bucket_id` | `aws_s3_bucket_id` | body | string |  | S3 bucket location for the export. Required when `action` is `portability`. |
| `aws_access_key_id` | `aws_access_key_id` | body | string |  | S3 bucket access key. Required when `action` is `portability`. Use `secret(name)`. |
| `aws_secret_access_key` | `aws_secret_access_key` | body | string |  | S3 bucket secret access key. Required when `action` is `portability`. Use `secret(name)`. |
| `aws_s3_folder` | `aws_s3_folder` | body | string |  | S3 bucket folder. Required when `action` is `portability`. |
| `aws_region` | `aws_region` | body | string |  | AWS region of the S3 bucket. Required when `action` is `portability`. |

```sql
CALL cdp.consent_update (
  action => 'portability',
  ids => '100000695',
  mode => 'cdp',
  status => 'optin',
  aws_s3_bucket_id => 'cdpgdprtest',
  aws_access_key_id => secret(consent_s3_access_key),
  aws_secret_access_key => secret(consent_s3_secret_key),
  aws_s3_folder => 'yyun/Person',
  aws_region => 'us-west-1'
);
```

**Result**

One row per top-level key of the response, where each key is a requested ID. Nothing goes to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | The response key. |
| `result` | `result` | VARCHAR | `Success`, or an error message. |
| `edited` | `edited` | JSON | Array of edited fields, each with `objectType`, `field`, `valueOfField` and `id`. |

This shape comes from the [general write page](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-write.md). The Data 360 page shows no write response, and `edited` names CRM objects there, so the shape for `mode=cdp` is unconfirmed.

**Notes:** **`shouldforget` is permanent.** [The docs](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-cdp-params.md) say it permanently deletes PII and any related records, and that a processed profile "can no longer be used again". They document no undo. Without `mode => 'cdp'`, the same call writes to CRM records instead.

It needs ModifyAllData or ConsentApiUpdate. The docs say to contact your Salesforce representative for consumer rights guidance.

The sources don't say when the deletion or export happens, or how to tell it's done. The response only reports the write.

Send `{}` as the body when no body option is set, as [the write page](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-consent-write.md) requires. That's the case for `processing` and `shouldforget`.

The sources disagree on a few points:

- **Export location:** the Data 360 page puts the `aws_*` fields directly in the body. The write page has a `blobParam` body parameter for the portability location, with no documented shape.
- **`status` under `mode=cdp`:** the write page says `mode=cdp` supports only `action`, `blobParam` and `ids`. The Data 360 page requires `status`, and it's followed here.
- **Spelling:** the Data 360 page uses `processing` and `shouldforget`, the write page `process` and `shouldForget`. For `status`, the Data 360 page and the write page's curl example use lowercase, while its table has `OptIn`, `OptOut`, `Seen` and `NotSeen`.
- **ID limit:** the write page allows up to 1,000 IDs as a JSON array in the body, `{"ids": [...]}`. The Data 360 examples pass one ID in the query string, and no source gives a limit there.

The write page's other options (`captureDate`, `captureContactPointType`, `captureSource`, `consentName`, `createIndividual`, `doubleOptIn`, `effectiveFrom`, `effectiveTo`, `individualName`, `purposeName`) are left out, since it says `mode=cdp` doesn't support them.

