//! The keys of the stored results of the scripts (docs/design/workbook_results.md), all in this file: the signature of
//! the AST of a script, the signature of a script with the values that it binds and the attachments that it reads, the
//! keys of the scripts of a plan in the order of their references, and the digest, SHA-256 of our own.
//!
//! A key covers what the result of a script depends on in the workbook and never its connection: who ran the query and
//! where stays out of the files and the archives. A key is a check, not an address: the file of a script is found by
//! the name of the script, the key in the name of the file tells whether the result still fits the script. Change
//! `RESULT_KEY_NAMESPACE` when anything that goes into a key changes, the scripts then run once more.

use std::fmt::Display;
use std::future::Future;

use dashql_buffers::execution::ExecutionGraphT;
use dashql_buffers::parser::{AttributeKey, Node, NodeType, StatementType};
use dashql_core::touched_relations::explain_executes;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::{ParsedScript, Statement};

use crate::executor::StoredFile;

/// The namespace of the keys, a new one is a new key of every script
const RESULT_KEY_NAMESPACE: &str = "dashql-result-v5";

/// The key of a stored result that matches no script, e.g. of an imported result: the result shows and stands in for
/// a script whose connection can't run, a run on its connection computes it anew
pub const UNMATCHED_RESULT_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// The result key of a script of a plan
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResultKey {
    /// The key, the file of the result of the script is named after it
    pub key: String,
    /// The signature that the key derives from: the signature of the script and the keys and files of the scripts it
    /// references, one per line
    pub signature: String,
    /// May a run read the stored result of the script instead of running it, if the file has this key? The script and
    /// the scripts it references are cacheable.
    pub reusable: bool,
}

/// The key of a signature, the lowercase hex of the SHA-256 digest of the signature in the namespace of the keys
pub fn result_key(signature: &str) -> String {
    let mut input = Vec::with_capacity(RESULT_KEY_NAMESPACE.len() + 1 + signature.len());
    input.extend_from_slice(RESULT_KEY_NAMESPACE.as_bytes());
    input.push(b'\n');
    input.extend_from_slice(signature.as_bytes());
    hex(&sha256(&input))
}

/// The signature of a script: the signature of its AST, then the values that it binds, `:min=10` per line, and the
/// stamps of the attachments that it reads, `attachment sales.parquet=<stamp>` per line. None for a script that doesn't
/// parse. The values are literals of the Hyper dialect whatever the connection, the keys of the scripts that it
/// references follow in `result_keys`.
pub fn script_signature<N: Display, V: Display, F: Display, S: Display>(
    parsed: &ParsedScript,
    values: impl IntoIterator<Item = (N, V)>,
    attachments: impl IntoIterator<Item = (F, S)>,
) -> Option<String> {
    let ast = ast_signature(parsed)?;
    let lines = std::iter::once(ast)
        .chain(values.into_iter().map(|(name, value)| format!(":{name}={value}")))
        .chain(attachments.into_iter().map(|(file, stamp)| format!("attachment {file}={stamp}")));
    Some(lines.collect::<Vec<_>>().join("\n"))
}

/// May a run reuse the stored result of a script? A script of queries that write nothing: a reuse skips the whole
/// script, so a script with commands before its query always runs, as does a query that writes, and a client function
/// call asks a service and not the backend.
pub fn cacheable(parsed: &ParsedScript, calls_client_functions: bool) -> bool {
    parses(parsed)
        && !parsed.statements.is_empty()
        && parsed.statements.iter().all(|s| {
            matches!(s.statement_type, StatementType::SELECT | StatementType::EXPLAIN) && !query_writes(parsed, s)
        })
        && !calls_client_functions
}

/// Does a node of a statement change the database when the statement runs? The statements that write or define
/// relations or functions, also nested ones.
pub fn mutating(node: &Node) -> bool {
    node.node_type() != NodeType::NONE
        && (matches!(
            node.node_type(),
            NodeType::OBJECT_SQL_INSERT
                | NodeType::OBJECT_SQL_DELETE
                | NodeType::OBJECT_SQL_UPDATE
                | NodeType::OBJECT_SQL_MERGE
                | NodeType::OBJECT_SQL_CREATE
                | NodeType::OBJECT_SQL_CREATE_AS
                | NodeType::OBJECT_SQL_VIEW
                | NodeType::OBJECT_SQL_CREATE_FUNCTION
        ) || node.attribute_key() == AttributeKey::SQL_SELECT_INTO)
}

/// Does a query write when it runs? A SELECT with a data-modifying WITH does, an EXPLAIN when it runs a statement that
/// writes (`explain (analyze) update ...`).
fn query_writes(parsed: &ParsedScript, statement: &Statement) -> bool {
    let begin = statement.nodes_begin as usize;
    let nodes = parsed.nodes.get(begin..begin + statement.node_count as usize).unwrap_or_default();
    if !nodes.iter().any(mutating) {
        return false;
    }
    if statement.statement_type != StatementType::EXPLAIN {
        return true;
    }
    let root = parsed.nodes.get(statement.root as usize);
    let options =
        root.and_then(|r| parsed.children(r).iter().find(|c| c.attribute_key() == AttributeKey::EXT_EXPLAIN_OPTIONS));
    explain_executes(parsed, options)
}

/// Did a script scan and parse without errors?
fn parses(parsed: &ParsedScript) -> bool {
    parsed.scanned.errors.is_empty() && parsed.errors.is_empty()
}

/// The signature of the AST of a script, 64 lowercase hex digits, none for a script with scanner or parser errors.
/// It covers the types of the statements and, per statement, the types of the nodes, their attribute keys, the names,
/// the literals and the operators in node order. Whitespace, comments (also `@vis` tags), source offsets and the ids of
/// the parser don't count.
pub fn ast_signature(parsed: &ParsedScript) -> Option<String> {
    if !parses(parsed) {
        return None;
    }
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&(parsed.statements.len() as u32).to_le_bytes());
    let mut statement_bytes = Vec::new();
    for statement in &parsed.statements {
        statement_bytes.clear();
        let begin = statement.nodes_begin as usize;
        // The nodes of a statement lie in the AST of a parsed script
        for node in parsed.nodes.get(begin..begin + statement.node_count as usize)? {
            append_node(parsed, node, &mut statement_bytes);
        }
        bytes.push(statement.statement_type.0);
        append_text(&mut bytes, &statement_bytes);
    }
    Some(hex(&sha256(&bytes)))
}

fn is_enum_node(node_type: NodeType) -> bool {
    let id = node_type.0;
    id > NodeType::ENUM_KEYS_.0 && id < NodeType::OBJECT_KEYS_.0
}

fn append_text(out: &mut Vec<u8>, text: &[u8]) {
    out.extend_from_slice(&(text.len() as u64).to_le_bytes());
    out.extend_from_slice(text);
}

fn append_node(parsed: &ParsedScript, node: &Node, out: &mut Vec<u8>) {
    let node_type = node.node_type();
    out.extend_from_slice(&node_type.0.to_le_bytes());
    out.extend_from_slice(&node.attribute_key().0.to_le_bytes());
    match node_type {
        NodeType::NONE | NodeType::LITERAL_NULL => {}
        NodeType::BOOL => out.push((node.children_begin_or_value() != 0) as u8),
        NodeType::NAME => append_text(out, parsed.scanned.names.get(node.children_begin_or_value()).text.as_bytes()),
        NodeType::OPERATOR
        | NodeType::LITERAL_INTEGER
        | NodeType::LITERAL_FLOAT
        | NodeType::LITERAL_STRING
        | NodeType::LITERAL_INTERVAL => {
            let scanned = &parsed.scanned;
            let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
            let bytes = scanned.text.as_bytes();
            let begin = (span.offset as usize).min(bytes.len());
            let end = (begin + span.length as usize).min(bytes.len());
            append_text(out, bytes.get(begin..end).unwrap_or_default());
        }
        NodeType::ARRAY => out.extend_from_slice(&(node.children_count()).to_le_bytes()),
        _ if is_enum_node(node_type) => out.extend_from_slice(&node.children_begin_or_value().to_le_bytes()),
        _ => out.extend_from_slice(&(node.children_count()).to_le_bytes()),
    }
}

/// Set the key of a script
fn set_key(keys: &mut [Option<Option<ResultKey>>], index: usize, key: Option<ResultKey>) {
    if let Some(slot) = keys.get_mut(index) {
        *slot = Some(key);
    }
}

/// The result keys of the scripts of a plan. The key of a script covers its signature and, for every script it
/// references, the key and the file of its result: a new result of a script is a new key of every script downstream
/// of it. None for scripts that aren't planned or have no signature, for those that `key_of` gives none and for those
/// that reference such a script. A plan that is invalid for one script keeps the keys of the others.
///
/// `key_of` takes the key of a script, e.g. the key of its stored file instead, or none. `file_of` settles the file of
/// the result of a script once its key is known, before the keys of the scripts downstream of it: the stored file that
/// it keeps or reuses, or the new file that it writes, none without one. The scripts settle in the order of their
/// references.
pub async fn result_keys<F, Fut, S, SFut>(graph: &ExecutionGraphT, key_of: F, file_of: S) -> Vec<Option<ResultKey>>
where
    F: Fn(u32, String) -> Fut,
    Fut: Future<Output = Option<String>>,
    S: Fn(u32, ResultKey) -> SFut,
    SFut: Future<Output = Option<String>>,
{
    let scripts = graph.scripts.as_deref().unwrap_or_default();
    // A key is derived once the keys of the scripts it references are known, a cycle never gets one
    let mut keys: Vec<Option<Option<ResultKey>>> = vec![None; scripts.len()];
    let mut files: Vec<Option<String>> = vec![None; scripts.len()];
    for _pass in 0..=scripts.len() {
        let mut progressed = false;
        for (index, script) in scripts.iter().enumerate() {
            if keys.get(index).is_some_and(Option::is_some) {
                continue;
            }
            if !script.planned || script.signature.is_none() {
                set_key(&mut keys, index, None);
                progressed = true;
                continue;
            }
            let references: Vec<u32> = script.referenced_scripts.clone().unwrap_or_default();
            let known: Option<Vec<Option<ResultKey>>> =
                references.iter().map(|r| keys.get(*r as usize).cloned().unwrap_or(Some(None))).collect();
            let Some(referenced) = known else { continue };
            progressed = true;
            if referenced.iter().any(Option::is_none) {
                set_key(&mut keys, index, None);
                continue;
            }
            let referenced: Vec<ResultKey> = referenced.into_iter().flatten().collect();
            let mut lines = vec![script.signature.clone().unwrap_or_default()];
            for (reference, key) in references.iter().zip(&referenced) {
                match files.get(*reference as usize).cloned().flatten() {
                    Some(file) => lines.push(format!("{} {file}", key.key)),
                    None => lines.push(key.key.clone()),
                }
            }
            let signature = lines.join("\n");
            let key = key_of(index as u32, result_key(&signature)).await.map(|key| ResultKey {
                key,
                signature,
                reusable: script.cacheable && referenced.iter().all(|r| r.reusable),
            });
            if let Some(key) = &key {
                let file = file_of(index as u32, key.clone()).await;
                if let Some(slot) = files.get_mut(index) {
                    *slot = file;
                }
            }
            set_key(&mut keys, index, key);
        }
        if !progressed {
            break;
        }
    }
    keys.into_iter().map(Option::flatten).collect()
}

/// The key that a run gives a script: its own key, or the key of its stored file if its connection can't run. The
/// stored result is all that a run can show of such a script, whatever its key: another version of the keys or an
/// earlier text of the script never keeps a result from rendering, and the keys of the scripts downstream of it cover
/// that file.
pub fn run_key(key: String, can_run: bool, stored: Option<&str>) -> String {
    match stored {
        Some(stored) if !can_run => stored.to_string(),
        _ => key,
    }
}

/// The keys of the scripts of a plan over their stored files, in feed order, as a run derives them (`run_key`): the
/// lookup of the stored results tells with them whether a stored result fits its script as it is now
/// (`ResultKey::script_key`). `can_run` tells by feed index whether the connection of a script can run.
pub async fn stored_result_keys(
    graph: &ExecutionGraphT,
    can_run: impl Fn(u32) -> bool,
    files: &[Option<StoredFile>],
) -> Vec<Option<ResultKey>> {
    let file = |script: u32| files.get(script as usize).and_then(Option::as_ref);
    result_keys(
        graph,
        |script, key| {
            let stored = file(script).map(|file| file.key.as_str());
            std::future::ready(Some(run_key(key, can_run(script), stored)))
        },
        |script, _key| std::future::ready(file(script).map(|file| file.name.clone())),
    )
    .await
}

impl ResultKey {
    /// The key of the script as it is now, from its signature. The key of a run differs for a script whose connection
    /// can't run, it is the key of its stored file then (`run_key`).
    pub fn script_key(&self) -> String {
        result_key(&self.signature)
    }
}

/// The lowercase hex of bytes
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The round constants of SHA-256, the first 32 bits of the fractional parts of the cube roots of the first 64 primes
const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
];

/// The SHA-256 digest of bytes (FIPS 180-4)
fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut state: [u32; 8] =
        [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    // The message, a one bit, zeros up to 56 bytes of the last block and the length in bits
    let mut message = Vec::with_capacity(bytes.len() + 72);
    message.extend_from_slice(bytes);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&((bytes.len() as u64).wrapping_mul(8)).to_be_bytes());
    let mut schedule: Vec<u32> = Vec::with_capacity(64);
    for block in message.chunks_exact(64) {
        schedule.clear();
        schedule.extend(block.chunks_exact(4).map(|word| u32::from_be_bytes(word.try_into().unwrap_or_default())));
        for i in 16..64 {
            let word = |offset: usize| schedule.get(i - offset).copied().unwrap_or_default();
            let (w15, w2) = (word(15), word(2));
            let s0 = w15.rotate_right(7) ^ w15.rotate_right(18) ^ (w15 >> 3);
            let s1 = w2.rotate_right(17) ^ w2.rotate_right(19) ^ (w2 >> 10);
            let next = word(16).wrapping_add(s0).wrapping_add(word(7)).wrapping_add(s1);
            schedule.push(next);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for (k, w) in SHA256_K.iter().zip(&schedule) {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(choice).wrapping_add(*k).wrapping_add(*w);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (word, add) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *word = word.wrapping_add(add);
        }
    }
    let mut digest = [0u8; 32];
    for (out, word) in digest.chunks_exact_mut(4).zip(state) {
        out.copy_from_slice(&word.to_be_bytes());
    }
    digest
}

#[cfg(test)]
mod tests {
    use super::*;
    use dashql_core::catalog::Catalog;
    use dashql_core::script::Script;
    use std::sync::Arc;

    fn parsed(text: &str) -> Arc<ParsedScript> {
        let catalog = Catalog::new();
        let mut script = Script::new(&catalog);
        script.replace_text(text);
        script.parse();
        script.parsed.take().unwrap()
    }

    fn signature(text: &str) -> String {
        ast_signature(&parsed(text)).unwrap()
    }

    #[test]
    fn sha256_matches_the_test_vectors_of_fips_180() {
        let digest = |text: &[u8]| hex(&sha256(text));
        assert_eq!(digest(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(digest(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            digest(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(digest(&[b'a'; 1_000_000]), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
        // A message that fills the last block up to its length, and one that needs another block for it
        assert_eq!(digest(&[b'x'; 55]).len(), 64);
        assert_ne!(digest(&[b'x'; 55]), digest(&[b'x'; 56]));
    }

    #[test]
    fn keys_are_lowercase_hex_of_the_namespaced_signature() {
        let key = result_key("signature");
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(key, result_key("signature"));
        assert_ne!(key, result_key("signature\n:min=1"));
        assert_ne!(key, UNMATCHED_RESULT_KEY);
    }

    #[test]
    fn keys_are_pinned() {
        // The key of a script with names, literals, operators, enums and objects. It changes with the namespace, the
        // encoding of the signatures and the ordinals of `NodeType` (proto/fb/dashql/parsed_script.fbs): a value inserted
        // before the end shifts them. A file of another version could then match another query, so a new key needs a
        // new RESULT_KEY_NAMESPACE with it.
        let text = "select a, count(*) from t where b = 'x' and c > 1.5 group by a order by a desc nulls last limit 10";
        assert_eq!(
            result_key(&signature(text)),
            "545b31c5ee68889b128230d3fbb3b02c8365a0e0d9f990a35d8d4718a534ef9b",
            "bump RESULT_KEY_NAMESPACE with a new key"
        );
    }

    #[test]
    fn empty_script_has_a_signature() {
        assert_eq!(signature(""), signature("  -- nothing\n"));
        assert_ne!(signature(""), signature("select 1"));
    }

    #[test]
    fn layout_and_comments_are_ignored() {
        assert_eq!(signature("select 1"), signature("  select   1 ;"));
        assert_eq!(signature("select a from t"), signature("select\n  a\nfrom /* x */ t -- y"));
        assert_eq!(signature("SELECT a FROM t"), signature("select a from t"));
    }

    #[test]
    fn literals_names_and_operators_matter() {
        let base = signature("select a + 1 from t where b = 'x'");
        assert_ne!(base, signature("select a + 2 from t where b = 'x'"));
        assert_ne!(base, signature("select a - 1 from t where b = 'x'"));
        assert_ne!(base, signature("select c + 1 from t where b = 'x'"));
        assert_ne!(base, signature("select a + 1 from u where b = 'x'"));
        assert_ne!(base, signature("select a + 1 from t where b = 'y'"));
        assert_ne!(signature("select 1.5"), signature("select 1.6"));
        assert_ne!(signature("select 1"), signature("select 1.0"));
        assert_ne!(signature("select interval '1 day'"), signature("select interval '2 day'"));
        assert_ne!(signature("select null"), signature("select 1"));
    }

    #[test]
    fn booleans_and_enums_matter() {
        assert_ne!(signature("select distinct a from t"), signature("select a from t"));
        assert_ne!(signature("select a from t order by a asc"), signature("select a from t order by a desc"));
        assert_ne!(
            signature("select a from t order by a nulls first"),
            signature("select a from t order by a nulls last")
        );
    }

    #[test]
    fn statement_count_and_order_matter() {
        assert_ne!(signature("select 1; select 2"), signature("select 1"));
        assert_ne!(signature("select 1; select 2"), signature("select 2; select 1"));
        assert_ne!(signature("create table t (a int); select a from t"), signature("select a from t"));
    }

    #[test]
    fn vis_tags_are_ignored() {
        let plain = signature("select a from t");
        assert_eq!(plain, signature("/* @vis table */ select a from t"));
        assert_eq!(plain, signature("/* @vis vegalite {\"mark\": \"bar\"} */\nselect a from t"));
        assert_ne!(plain, signature("/* @vis table */ select b from t"));
    }

    #[test]
    fn scripts_with_errors_have_no_signature() {
        assert_eq!(ast_signature(&parsed("select 1 +;")), None);
        assert_eq!(ast_signature(&parsed("select 'unterminated")), None);
        assert!(!cacheable(&parsed("select 1 +;"), false));
    }

    #[test]
    fn a_script_signature_holds_its_values_and_attachments() {
        let script = parsed("select * from t where a > :min");
        let ast = ast_signature(&script).unwrap();
        let none: [(&str, &str); 0] = [];
        assert_eq!(script_signature(&script, none, none).unwrap(), ast);
        assert_eq!(
            script_signature(&script, [("min", "10")], [("sales.parquet", "s1")]).unwrap(),
            format!("{ast}\n:min=10\nattachment sales.parquet=s1")
        );
    }

    #[test]
    fn only_scripts_of_queries_are_cacheable() {
        assert!(cacheable(&parsed("select 1; select 2"), false));
        assert!(!cacheable(&parsed("select 1"), true));
        assert!(!cacheable(&parsed("create table t as select 1; select * from t"), false));
        assert!(!cacheable(&parsed(""), false));
        // A query that writes runs every time
        assert!(!cacheable(&parsed("with gone as (delete from t returning a) select * from gone"), false));
        assert!(!cacheable(&parsed("explain (analyze) update t set a = 1"), false));
        assert!(!cacheable(&parsed("explain (analyze) create table u as select 1"), false));
        // An EXPLAIN that doesn't run its statement writes nothing
        assert!(cacheable(&parsed("explain update t set a = 1"), false));
        assert!(cacheable(&parsed("explain (analyze) select * from t"), false));
    }
}
