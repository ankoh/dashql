//! Client functions: a declarative description of an API that shadows a namespace of `CALL` on a connection.
//!
//! A host registers a spec on the catalog of a connection (see `docs/design/extensions.md`). The core reads the
//! generic part of the spec: namespaces, functions, typed named options, nested schemas and result columns. Everything
//! a request needs (methods, paths, API names) stays in the document for the runtime of the host, the core ignores it.

use crate::error::{Error, Result};
use crate::hash::HashMap;
use serde::{Deserialize, Deserializer};

/// The version of the format that the core reads
pub const CLIENT_FUNCTION_FORMAT: u32 = 1;

/// The standard option that takes the next page of a paged function
pub const OPTION_NEXT: &str = "_next";
/// The standard option that limits the pages of a call
pub const OPTION_PAGES: &str = "_pages";
/// The standard option that polls a pending result
pub const OPTION_POLL: &str = "_poll";
/// The standard option that waits for a pending result
pub const OPTION_WAIT: &str = "_wait";

/// What an option or attribute that the spec does not list does
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientFunctionUnknownPolicy {
    /// An error
    #[default]
    Error,
    /// A warning, it is sent as written. For schemas that may be incomplete.
    Warning,
    /// Accepted silently, for free-form maps
    Allow,
}

/// Does a function change anything?
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientFunctionEffect {
    Read,
    Write,
}

/// An option of a function or an attribute of a schema
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionAttribute {
    /// The name in a script
    pub name: String,
    /// The spelling of the API. Only the check of a union reads it, the runtime sends it.
    pub api_name: Option<String>,
    /// The type of a scalar value
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    /// The schema of an object value
    pub schema: Option<String>,
    /// Is the attribute required?
    pub required: bool,
    /// The description that completion shows
    pub description: Option<String>,
}

/// The attribute of a union whose value selects the variant
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionTag {
    /// The attribute
    pub attribute: String,
    /// The variant of a value, whatever its case. A value that is not listed selects nothing.
    pub values: HashMap<String, String>,
}

/// A named object, or a union of named objects
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionSchema {
    /// The attributes, a union has none
    pub attributes: Vec<ClientFunctionAttribute>,
    /// What an attribute that is not listed does
    pub unknown: ClientFunctionUnknownPolicy,
    /// The schemas that a value of a union can be
    pub variants: Vec<String>,
    /// What selects the variant of a union, without it only the attributes of a value decide
    pub tag: Option<ClientFunctionTag>,
}

impl ClientFunctionSchema {
    /// Does an object of this schema take a name?
    fn takes(&self, name: &str, quoted: bool) -> bool {
        self.unknown == ClientFunctionUnknownPolicy::Allow || find_attribute(&self.attributes, name, quoted).is_some()
    }
}

/// A field of an object, as far as it decides a variant
#[derive(Clone, Debug, Default)]
pub struct ClientFunctionField {
    /// The name in the script
    pub name: String,
    /// Was the name quoted?
    pub quoted: bool,
    /// The value, if it is a string
    pub text: Option<String>,
}

/// What an object can be
#[derive(Debug)]
pub struct ClientFunctionFit<'a> {
    /// The variants that fit, the only one of a schema that is no union. Never empty.
    pub variants: Vec<&'a ClientFunctionSchema>,
    /// The field whose value selected the variant
    pub tag_field: Option<usize>,
    /// The fields that another variant takes, but none that fits the fields before them
    pub conflicts: Vec<usize>,
}

impl ClientFunctionFit<'_> {
    /// What an attribute that no variant lists does: the most lenient variant decides
    pub fn unknown(&self) -> ClientFunctionUnknownPolicy {
        let policy = |p: ClientFunctionUnknownPolicy| self.variants.iter().any(|v| v.unknown == p);
        if policy(ClientFunctionUnknownPolicy::Allow) {
            ClientFunctionUnknownPolicy::Allow
        } else if policy(ClientFunctionUnknownPolicy::Warning) {
            ClientFunctionUnknownPolicy::Warning
        } else {
            ClientFunctionUnknownPolicy::Error
        }
    }
}

/// A result column
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionColumn {
    /// The name in a script
    pub name: String,
    /// The column type
    #[serde(rename = "type")]
    pub column_type: Option<String>,
}

/// The paging of a function, as far as checks need it
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionPaging {
    /// The kind: `url`, `token`, `offset` or `page`
    pub kind: String,
    /// The option that `_next` sets, none for `url`
    pub option: Option<String>,
}

/// A function of a spec
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunction {
    /// The name in a script
    pub name: String,
    /// The grouping for documentation and completion
    pub family: Option<String>,
    /// The HTTP method, it decides the default effect
    pub method: Option<String>,
    /// The options
    pub options: Vec<ClientFunctionAttribute>,
    /// What an option that is not listed does
    pub unknown: ClientFunctionUnknownPolicy,
    /// The result columns
    pub columns: Vec<ClientFunctionColumn>,
    /// The paging, if the function pages
    pub paging: Option<ClientFunctionPaging>,
    /// Absent takes the default of the spec, null means none
    #[serde(deserialize_with = "present")]
    pub pending: Option<serde_json::Value>,
    /// The declared effect
    pub effect: Option<ClientFunctionEffect>,
    /// The escape hatch: any option goes
    pub raw: bool,
}

/// Tell a null value from an absent field
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Option<serde_json::Value>, D::Error> {
    serde_json::Value::deserialize(deserializer).map(Some)
}

impl ClientFunction {
    /// The effect, a write without a declaration unless the method only reads. A raw function can do anything.
    pub fn effect(&self) -> ClientFunctionEffect {
        match (self.raw, self.effect, self.method.as_deref()) {
            (true, ..) => ClientFunctionEffect::Write,
            (false, Some(effect), _) => effect,
            (false, None, Some(method)) if method.eq_ignore_ascii_case("GET") => ClientFunctionEffect::Read,
            (false, None, _) => ClientFunctionEffect::Write,
        }
    }

    /// What an option that is not listed does
    pub fn unknown_options(&self) -> ClientFunctionUnknownPolicy {
        if self.raw { ClientFunctionUnknownPolicy::Allow } else { self.unknown }
    }

    /// The standard options of the function
    pub fn standard_options(&self, spec: &ClientFunctionSpec) -> Vec<&'static str> {
        let mut options = Vec::new();
        if self.paging.is_some() {
            options.push(OPTION_NEXT);
            if self.effect() == ClientFunctionEffect::Read {
                options.push(OPTION_PAGES);
            }
        }
        if spec.has_pending(self) {
            options.push(OPTION_POLL);
            options.push(OPTION_WAIT);
        }
        options
    }
}

/// The spec of client functions
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionSpec {
    /// The version of the format
    pub format: u32,
    /// The prefix of the functions
    pub namespace: String,
    /// The title of the service
    pub title: Option<String>,
    /// The default for functions that can answer before they finish
    pub pending: Option<serde_json::Value>,
    /// The named objects
    pub schemas: HashMap<String, ClientFunctionSchema>,
    /// The functions
    pub functions: Vec<ClientFunction>,
    /// The functions by name
    #[serde(skip)]
    functions_by_name: HashMap<String, usize>,
}

/// Is a name a plain identifier in lower case?
fn is_plain_lowercase(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|c| c.is_ascii_lowercase() || c == b'_') && bytes.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

/// Check the attributes of a function or a schema
fn check_attributes(owner: &str, attributes: &[ClientFunctionAttribute], schemas: &HashMap<String, ClientFunctionSchema>) -> Result<()> {
    for (i, attribute) in attributes.iter().enumerate() {
        if attribute.name.is_empty() {
            return Err(Error::invalid_argument(format!("{owner}: an attribute has no name")));
        }
        if attributes[..i].iter().any(|a| a.name.eq_ignore_ascii_case(&attribute.name)) {
            return Err(Error::invalid_argument(format!("{owner}: duplicate attribute {}", attribute.name)));
        }
        if let Some(schema) = attribute.schema.as_ref().filter(|s| !schemas.contains_key(*s)) {
            return Err(Error::invalid_argument(format!("{owner}.{}: unknown schema {schema}", attribute.name)));
        }
    }
    Ok(())
}

/// Check the variants and the tag of a union
fn check_union(owner: &str, schema: &ClientFunctionSchema, schemas: &HashMap<String, ClientFunctionSchema>) -> Result<()> {
    let invalid = |message: String| Err(Error::invalid_argument(format!("{owner}: {message}")));
    if schema.variants.is_empty() {
        return if schema.tag.is_some() { invalid("a tag needs variants".to_string()) } else { Ok(()) };
    }
    if !schema.attributes.is_empty() {
        return invalid("a union has variants instead of attributes".to_string());
    }
    let mut attributes: Vec<&ClientFunctionAttribute> = Vec::new();
    for name in &schema.variants {
        let Some(variant) = schemas.get(name) else { return invalid(format!("unknown variant {name}")) };
        if !variant.variants.is_empty() {
            return invalid(format!("the variant {name} is a union"));
        }
        // A name means one thing in a union, so that neither a request nor a nested check depends on the variant
        for attribute in &variant.attributes {
            match attributes.iter().find(|a| a.name.eq_ignore_ascii_case(&attribute.name)) {
                Some(other) if other.api_name != attribute.api_name || other.schema != attribute.schema => {
                    return invalid(format!("the variants disagree on the attribute {}", attribute.name));
                }
                Some(_) => {}
                None => attributes.push(attribute),
            }
        }
    }
    for (value, name) in schema.tag.iter().flat_map(|t| t.values.iter()) {
        let tag = schema.tag.as_ref().map_or("", |t| t.attribute.as_str());
        if !schema.variants.contains(name) {
            return invalid(format!("the tag value {value} selects {name}, which is no variant"));
        }
        if schemas.get(name).is_some_and(|v| find_attribute(&v.attributes, tag, false).is_none()) {
            return invalid(format!("the variant {name} has no attribute {tag}"));
        }
    }
    Ok(())
}

impl ClientFunctionSpec {
    /// Read and check a spec
    pub fn parse(json: &str) -> Result<Self> {
        let mut spec: ClientFunctionSpec =
            serde_json::from_str(json).map_err(|e| Error::invalid_argument(format!("invalid client function spec: {e}")))?;
        if spec.format != CLIENT_FUNCTION_FORMAT {
            return Err(Error::invalid_argument(format!("unsupported client function spec format {}", spec.format)));
        }
        if !is_plain_lowercase(&spec.namespace) {
            return Err(Error::invalid_argument(format!("invalid namespace {:?}", spec.namespace)));
        }
        for (name, schema) in &spec.schemas {
            check_attributes(name, &schema.attributes, &spec.schemas)?;
            check_union(name, schema, &spec.schemas)?;
        }
        for (i, function) in spec.functions.iter().enumerate() {
            if !is_plain_lowercase(&function.name) {
                return Err(Error::invalid_argument(format!("invalid function name {:?}", function.name)));
            }
            if spec.functions_by_name.insert(function.name.clone(), i).is_some() {
                return Err(Error::invalid_argument(format!("duplicate function {}", function.name)));
            }
            check_attributes(&function.name, &function.options, &spec.schemas)?;
            // The standard options and columns start with an underscore
            if let Some(option) = function.options.iter().find(|o| o.name.starts_with('_')) {
                return Err(Error::invalid_argument(format!("{}: the name {} is reserved", function.name, option.name)));
            }
            if let Some(column) = function.columns.iter().find(|c| c.name.starts_with('_')) {
                return Err(Error::invalid_argument(format!("{}: the column {} is reserved", function.name, column.name)));
            }
        }
        Ok(spec)
    }

    /// A function by its lower-case name
    pub fn function(&self, name: &str) -> Option<&ClientFunction> {
        self.functions_by_name.get(name).map(|&i| &self.functions[i])
    }

    /// A schema by name
    pub fn schema(&self, name: &str) -> Option<&ClientFunctionSchema> {
        self.schemas.get(name)
    }

    /// The variants of a schema, a schema that is no union is its own only variant
    fn variants_of<'a>(&'a self, schema: &'a ClientFunctionSchema) -> Vec<&'a ClientFunctionSchema> {
        if schema.variants.is_empty() {
            return vec![schema];
        }
        schema.variants.iter().filter_map(|name| self.schema(name)).collect()
    }

    /// The attribute that a name selects in a schema. A name means one thing in a union, so any variant can answer.
    pub fn attribute_of<'a>(&'a self, schema: &'a ClientFunctionSchema, name: &str, quoted: bool) -> Option<&'a ClientFunctionAttribute> {
        self.variants_of(schema).into_iter().find_map(|variant| find_attribute(&variant.attributes, name, quoted))
    }

    /// What an object with these fields can be. A tag selects its variant. Then every field in script order keeps the
    /// variants that take it, and one that would leave none is a conflict. A name that no variant takes says nothing.
    pub fn fit<'a>(&'a self, schema: &'a ClientFunctionSchema, fields: &[ClientFunctionField]) -> ClientFunctionFit<'a> {
        let variants = self.variants_of(schema);
        let mut fit = ClientFunctionFit { variants: variants.clone(), tag_field: None, conflicts: Vec::new() };
        if let Some(tag) = &schema.tag {
            let is_tag = |f: &ClientFunctionField| if f.quoted { f.name == tag.attribute } else { f.name.eq_ignore_ascii_case(&tag.attribute) };
            if let Some(i) = fields.iter().position(is_tag) {
                let selected = fields[i].text.as_ref().and_then(|text| tag.values.iter().find(|(value, _)| value.eq_ignore_ascii_case(text)));
                if let Some(variant) = selected.and_then(|(_, name)| self.schema(name)) {
                    fit.variants = vec![variant];
                    fit.tag_field = Some(i);
                }
            }
        }
        for (i, field) in fields.iter().enumerate() {
            if !variants.iter().any(|v| v.takes(&field.name, field.quoted)) {
                continue;
            }
            let fitting: Vec<_> = fit.variants.iter().copied().filter(|v| v.takes(&field.name, field.quoted)).collect();
            if fitting.is_empty() {
                // A quoted name means what it says
                if !field.quoted {
                    fit.conflicts.push(i);
                }
            } else {
                fit.variants = fitting;
            }
        }
        fit
    }

    /// Can a function answer before it finishes?
    pub fn has_pending(&self, function: &ClientFunction) -> bool {
        let is_set = |value: &serde_json::Value| !value.is_null();
        match &function.pending {
            Some(pending) => is_set(pending),
            None => self.pending.as_ref().is_some_and(is_set),
        }
    }
}

/// The attribute that a name in a script selects. An unquoted name folds its case, a quoted one is exact.
pub fn find_attribute<'a>(attributes: &'a [ClientFunctionAttribute], name: &str, quoted: bool) -> Option<&'a ClientFunctionAttribute> {
    if quoted {
        attributes.iter().find(|a| a.name == name)
    } else {
        attributes.iter().find(|a| a.name.eq_ignore_ascii_case(name))
    }
}

/// A name without case and underscores: `batchSize` and `batch_size` are the same mistake
fn normalized(name: &str) -> Vec<u8> {
    name.bytes().filter(|&c| c != b'_').map(|c| c.to_ascii_lowercase()).collect()
}

/// The edit distance of two byte strings
fn edit_distance(l: &[u8], r: &[u8]) -> usize {
    let mut row: Vec<usize> = (0..=r.len()).collect();
    for (i, lc) in l.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, rc) in r.iter().enumerate() {
            let cost = diagonal + usize::from(lc != rc);
            diagonal = row[j + 1];
            row[j + 1] = cost.min(row[j] + 1).min(row[j + 1] + 1);
        }
    }
    row[r.len()]
}

/// The candidate closest to a misspelled name, if one is close enough
pub fn closest_name<'a>(name: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    let name = normalized(name);
    let limit = (name.len() / 3).max(2);
    candidates
        .map(|candidate| (edit_distance(&name, &normalized(candidate)), candidate))
        .filter(|(distance, _)| *distance <= limit)
        .min_by_key(|(distance, candidate)| (*distance, *candidate))
        .map(|(_, candidate)| candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn function(name: &str, extra: &str) -> String {
        format!(r#"{{"format": 1, "namespace": "t", "functions": [{{"name": "{name}"{extra}}}]}}"#)
    }

    #[test]
    fn rejects_invalid_specs() {
        assert!(ClientFunctionSpec::parse("{").is_err());
        assert!(ClientFunctionSpec::parse(r#"{"format": 2, "namespace": "t"}"#).is_err());
        assert!(ClientFunctionSpec::parse(r#"{"format": 1, "namespace": "T"}"#).is_err());
        assert!(ClientFunctionSpec::parse(&function("F", "")).is_err());
        assert!(ClientFunctionSpec::parse(&function("f", r#", "options": [{"name": "_next"}]"#)).is_err());
        assert!(ClientFunctionSpec::parse(&function("f", r#", "columns": [{"name": "_raw"}]"#)).is_err());
        assert!(ClientFunctionSpec::parse(&function("f", r#", "options": [{"name": "a", "schema": "Nope"}]"#)).is_err());
        assert!(ClientFunctionSpec::parse(&function("f", r#", "options": [{"name": "a"}, {"name": "A"}]"#)).is_err());
    }

    const UNION: &str = r#"{"format": 1, "namespace": "t", "schemas": {
        "A": {"attributes": [{"name": "kind"}, {"name": "a"}, {"name": "both"}]},
        "B": {"attributes": [{"name": "kind"}, {"name": "b"}, {"name": "both"}]},
        "C": {"attributes": [{"name": "c"}]},
        "Tagged": {"variants": ["A", "B"], "tag": {"attribute": "kind", "values": {"IsA": "A", "IsB": "B"}}},
        "Shape": {"variants": ["A", "C"]}
    }}"#;

    fn union(schemas: &str) -> Result<ClientFunctionSpec> {
        ClientFunctionSpec::parse(&format!(r#"{{"format": 1, "namespace": "t", "schemas": {schemas}}}"#))
    }

    #[test]
    fn rejects_invalid_unions() {
        let a = r#""A": {"attributes": [{"name": "x", "api_name": "X"}]}"#;
        assert!(union(&format!(r#"{{{a}, "U": {{"variants": ["A"]}}}}"#)).is_ok());
        assert!(union(&format!(r#"{{{a}, "U": {{"variants": ["Nope"]}}}}"#)).is_err());
        assert!(union(&format!(r#"{{{a}, "U": {{"variants": ["A"], "attributes": [{{"name": "y"}}]}}}}"#)).is_err());
        assert!(union(&format!(r#"{{{a}, "U": {{"variants": ["A"]}}, "V": {{"variants": ["U"]}}}}"#)).is_err());
        assert!(union(&format!(r#"{{{a}, "U": {{"tag": {{"attribute": "x", "values": {{}}}}}}}}"#)).is_err());
        // A tag selects a variant of the union that has the tag
        assert!(union(&format!(r#"{{{a}, "U": {{"variants": ["A"], "tag": {{"attribute": "x", "values": {{"v": "A"}}}}}}}}"#)).is_ok());
        assert!(union(&format!(r#"{{{a}, "Z": {{}}, "U": {{"variants": ["A"], "tag": {{"attribute": "x", "values": {{"v": "Z"}}}}}}}}"#)).is_err());
        assert!(union(&format!(r#"{{{a}, "U": {{"variants": ["A"], "tag": {{"attribute": "y", "values": {{"v": "A"}}}}}}}}"#)).is_err());
        // A name means one thing in a union
        let api_name = r#""B": {"attributes": [{"name": "x", "api_name": "Other"}]}"#;
        assert!(union(&format!(r#"{{{a}, {api_name}, "U": {{"variants": ["A", "B"]}}}}"#)).is_err());
        let schema = r#""B": {"attributes": [{"name": "x", "api_name": "X", "schema": "A"}]}"#;
        assert!(union(&format!(r#"{{{a}, {schema}, "U": {{"variants": ["A", "B"]}}}}"#)).is_err());
    }

    fn field(name: &str, text: Option<&str>) -> ClientFunctionField {
        ClientFunctionField { name: name.to_string(), quoted: false, text: text.map(str::to_string) }
    }

    #[test]
    fn fits_variants() {
        let spec = ClientFunctionSpec::parse(UNION).unwrap();
        let fit = |schema: &str, fields: &[ClientFunctionField]| {
            let schema = &spec.schemas[schema];
            let fit = spec.fit(schema, fields);
            let names: Vec<&str> = fit.variants.iter().map(|v| v.attributes[1.min(v.attributes.len() - 1)].name.as_str()).collect();
            (names.join(","), fit.tag_field, fit.conflicts)
        };
        // Nothing yet: any variant
        assert_eq!(fit("Tagged", &[]), ("a,b".to_string(), None, vec![]));
        // The value selects the variant, whatever its case
        assert_eq!(fit("Tagged", &[field("kind", Some("isb"))]), ("b".to_string(), Some(0), vec![]));
        // A wrong attribute for the tag, in any order
        assert_eq!(fit("Tagged", &[field("a", None), field("KIND", Some("IsB"))]), ("b".to_string(), Some(1), vec![0]));
        // A value that isn't listed or isn't known yet selects nothing, the attributes decide
        assert_eq!(fit("Tagged", &[field("kind", Some("Other")), field("a", None)]), ("a".to_string(), None, vec![]));
        assert_eq!(fit("Tagged", &[field("kind", None), field("b", None)]), ("b".to_string(), None, vec![]));
        // Without a tag the attributes decide, the first one that leaves no variant is the conflict
        assert_eq!(fit("Shape", &[field("a", None), field("c", None)]), ("a".to_string(), None, vec![1]));
        assert_eq!(fit("Shape", &[field("c", None), field("a", None)]), ("c".to_string(), None, vec![1]));
        // A name that no variant takes says nothing
        assert_eq!(fit("Shape", &[field("nope", None)]), ("a,c".to_string(), None, vec![]));
        // A shared attribute keeps both
        assert_eq!(fit("Tagged", &[field("both", None)]), ("a,b".to_string(), None, vec![]));
        // A quoted name means what it says, it's no conflict
        let quoted = ClientFunctionField { name: "c".to_string(), quoted: true, text: None };
        assert_eq!(fit("Shape", &[field("a", None), quoted]), ("a".to_string(), None, vec![]));
    }

    #[test]
    fn ignores_what_the_runtime_reads() {
        let spec = ClientFunctionSpec::parse(&function("f", r#", "path": "/x", "host": "api", "rows": "", "billed": true"#)).unwrap();
        assert!(spec.function("f").is_some());
    }

    #[test]
    fn effects() {
        let effect = |extra: &str| {
            let spec = ClientFunctionSpec::parse(&function("f", extra)).unwrap();
            spec.function("f").unwrap().effect()
        };
        assert_eq!(effect(r#", "method": "GET""#), ClientFunctionEffect::Read);
        assert_eq!(effect(r#", "method": "POST""#), ClientFunctionEffect::Write);
        assert_eq!(effect(r#", "method": "POST", "effect": "read""#), ClientFunctionEffect::Read);
        assert_eq!(effect(""), ClientFunctionEffect::Write);
        assert_eq!(effect(r#", "method": "GET", "effect": "read", "raw": true"#), ClientFunctionEffect::Write);
    }

    #[test]
    fn pending_follows_the_default_of_the_spec() {
        let spec = ClientFunctionSpec::parse(
            r#"{"format": 1, "namespace": "t", "pending": {"status": 202}, "functions": [
                {"name": "a"}, {"name": "b", "pending": null}
            ]}"#,
        )
        .unwrap();
        assert!(spec.has_pending(spec.function("a").unwrap()));
        assert!(!spec.has_pending(spec.function("b").unwrap()));
    }

    #[test]
    fn finds_close_names() {
        let names = ["batch_size", "offset", "segment_id"];
        assert_eq!(closest_name("batchsize", names.iter().copied()), Some("batch_size"));
        assert_eq!(closest_name("batchSize", names.iter().copied()), Some("batch_size"));
        assert_eq!(closest_name("ofset", names.iter().copied()), Some("offset"));
        assert_eq!(closest_name("completely_else", names.iter().copied()), None);
    }
}
