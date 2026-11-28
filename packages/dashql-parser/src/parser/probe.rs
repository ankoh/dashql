//! The LR probes of the completion.
//!
//! The probes run the automaton without grammar actions, only the state numbers matter:
//! - [`parse_until_with_snapshot`] parses up to the cursor token, returns the expected symbols there
//!   and a snapshot of the state stack,
//! - [`parse_until_after`] feeds a symbol at the cursor and returns the expected symbols after it,
//! - [`probe_suffix_batch`] and [`probe_suffix_sequence`] replay the tokens after the cursor from a
//!   snapshot to test whether candidate symbols fit the rest of the script.

use super::driver::{
    default_rule, feed, inside_statement, is_default_state, lac_check, rule_length, rule_lhs, state_below,
    statement_bottom, table_action, Action, StateId, NO_STATE,
};
use crate::keywords::Keyword;
use crate::scanner::Symbol;
use crate::symbol_kind::*;
use crate::tables::*;
use crate::SymbolKind;

/// A completion replay stops after this many reductions without a shift. A restored prefix can enter
/// nullable reduction cycles that a regular parse never reaches.
const MAX_REDUCTIONS_WITHOUT_SHIFT: usize = 128;

/// The state stack before the read of the cursor token
#[derive(Clone, Debug, Default)]
pub struct PrefixSnapshot {
    /// The states, bottom to top
    pub state_stack: Vec<StateId>,
    /// The state stacks after the other tokens of the keyword before the cursor. The scanner picks the lookahead token
    /// of a keyword by the token after it, which is the one at the cursor: `where a not |` reads NOT, but what is
    /// typed at the cursor can make it NOT_LA (`not between`).
    pub alternatives: Vec<Vec<StateId>>,
    /// Did the prefix parse reach the cursor without failing or accepting first?
    pub reached_target: bool,
    /// Does the parser recover from an error at the cursor? It shifted fewer than three tokens since the error, and
    /// drops the tokens that don't fit.
    pub recovering: bool,
}

impl PrefixSnapshot {
    /// The state stack that takes a token at the cursor, the regular one unless only an alternative does
    fn stack_for(&self, token: SymbolKind) -> &[StateId] {
        let mut scratch = Vec::new();
        if self.alternatives.is_empty() || lac_check(&self.state_stack, token, &mut scratch) {
            return &self.state_stack;
        }
        self.alternatives
            .iter()
            .find(|states| lac_check(states, token, &mut scratch))
            .map_or(&self.state_stack, |states| states.as_slice())
    }
}

/// A keyword with its lookahead tokens, or the symbol alone
fn token_variants(kind: SymbolKind) -> Vec<SymbolKind> {
    let base = Keyword::base(kind);
    let tokens = Keyword::lookahead_tokens(base);
    if tokens.is_empty() {
        return vec![kind];
    }
    std::iter::once(base).chain(tokens.iter().copied()).collect()
}

/// The expected symbols at the cursor and the snapshot they were computed from
#[derive(Clone, Debug, Default)]
pub struct ExpectedAtCursor {
    /// The tokens the parser would eventually shift at the cursor, empty if the cursor was not reached
    pub expected: Vec<SymbolKind>,
    /// The state stack before the read of the cursor token
    pub prefix: PrefixSnapshot,
}

/// How a fed symbol fits the tokens after the cursor
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SuffixProbe {
    /// Did the next real token shift after the fed symbols?
    pub k1_compatible: bool,
    /// The number of real tokens shifted before an error or the accept
    pub depth_consumed: u16,
    /// Did the replay accept?
    pub reached_eof: bool,
}

/// The token reader of the probes, a `TokenStream` without semantic values
struct Tokens<'a> {
    /// The scanned symbols
    symbols: &'a [Symbol],
    /// The index of the next symbol to read, EOF past the end
    next_index: u32,
}

impl Tokens<'_> {
    fn next(&mut self) -> SymbolKind {
        match self.symbols.get(self.next_index as usize) {
            Some(symbol) => {
                self.next_index += 1;
                symbol.kind
            }
            None => S_YYEOF,
        }
    }
}

/// The hooks of the driver
trait Policy {
    /// Inspect or replace a token that was just read. `pre_index` is the token index before the read,
    /// rewind `tokens` to it to read the real token again later.
    fn on_lookahead_read(
        &mut self,
        states: &[StateId],
        next: &mut SymbolKind,
        pre_index: u32,
        tokens: &mut Tokens,
        stop: &mut bool,
    );
    fn on_shifted(&mut self, _kind: SymbolKind) {}
    /// The parser starts to recover from an error
    fn on_recover(&mut self) {}
    fn on_accept(&mut self) {}
    /// Stop instead of recovering from an error?
    fn short_circuit_on_error(&mut self, _states: &[StateId]) -> bool {
        false
    }
}

/// Run the automaton without actions
fn drive<P: Policy>(policy: &mut P, states: &mut Vec<StateId>, tokens: &mut Tokens) {
    let mut lookahead: Option<SymbolKind> = None;
    let mut lac_established = false;
    let mut scratch = Vec::new();
    let mut errstatus = 0;
    let mut reductions_without_shift = 0;
    // Does the recovery drop the rest of the statement?
    let mut unwind = false;

    enum Label {
        NewState,
        Default,
        Reduce(usize),
        ErrLab,
        ErrLab1,
    }
    let mut label = Label::NewState;
    loop {
        label = match label {
            Label::NewState => {
                let state = states.last().copied().unwrap_or(NO_STATE);
                if state == YYFINAL {
                    policy.on_accept();
                    return;
                }
                if is_default_state(state) {
                    Label::Default
                } else {
                    let kind = match lookahead {
                        Some(kind) => kind,
                        None => {
                            let pre_index = tokens.next_index;
                            let mut next = tokens.next();
                            let mut stop = false;
                            policy.on_lookahead_read(states, &mut next, pre_index, tokens, &mut stop);
                            if stop {
                                return;
                            }
                            next = resolve_lookahead_token(states, next, &mut scratch);
                            lookahead = Some(next);
                            next
                        }
                    };
                    let mut establish = |states: &[StateId]| {
                        if !lac_established {
                            lac_established = true;
                            return lac_check(states, kind, &mut scratch);
                        }
                        true
                    };
                    match table_action(state, kind) {
                        None => {
                            if establish(states) {
                                Label::Default
                            } else {
                                Label::ErrLab
                            }
                        }
                        Some(Action::Error) => Label::ErrLab,
                        Some(Action::Reduce(rule)) => {
                            if establish(states) {
                                Label::Reduce(rule)
                            } else {
                                Label::ErrLab
                            }
                        }
                        Some(Action::Shift(next)) => {
                            if errstatus > 0 {
                                errstatus -= 1;
                            }
                            states.push(next);
                            lookahead = None;
                            lac_established = false;
                            reductions_without_shift = 0;
                            policy.on_shifted(kind);
                            Label::NewState
                        }
                    }
                }
            }
            Label::Default => match default_rule(states.last().copied().unwrap_or(NO_STATE)) {
                0 => Label::ErrLab,
                rule => Label::Reduce(rule),
            },
            Label::Reduce(rule) => {
                reductions_without_shift += 1;
                if reductions_without_shift > MAX_REDUCTIONS_WITHOUT_SHIFT {
                    return;
                }
                let len = rule_length(rule);
                let next = super::driver::goto_state(state_below(states, len), rule_lhs(rule));
                states.truncate(states.len().saturating_sub(len));
                states.push(next);
                Label::NewState
            }
            Label::ErrLab => {
                if policy.short_circuit_on_error(states) {
                    return;
                }
                if errstatus == 3 {
                    match lookahead {
                        Some(S_YYEOF) => return,
                        // Like the parser, a statement separator ends the statement and stays for the next one
                        Some(S_SEMICOLON) if inside_statement(states) => unwind = true,
                        Some(_) => lookahead = None,
                        None => {}
                    }
                }
                Label::ErrLab1
            }
            Label::ErrLab1 => {
                errstatus = 3;
                policy.on_recover();
                if std::mem::take(&mut unwind) {
                    if let Some(bottom) = statement_bottom(states) {
                        states.truncate(bottom + 1);
                    }
                }
                let next = loop {
                    if let Some(Action::Shift(next)) =
                        table_action(states.last().copied().unwrap_or(NO_STATE), S_YYerror)
                    {
                        break next;
                    }
                    if states.len() <= 1 {
                        return;
                    }
                    states.pop();
                };
                lac_established = false;
                states.push(next);
                Label::NewState
            }
        };
    }
}

/// The lookahead token of a keyword that only it fits. The scanner picks a lookahead token by the token after the
/// keyword, which is not typed yet at the cursor: `order by a nulls ` reads NULLS, which fits as NULLS_LA only.
fn resolve_lookahead_token(states: &[StateId], kind: SymbolKind, scratch: &mut Vec<StateId>) -> SymbolKind {
    let tokens = Keyword::lookahead_tokens(kind);
    if tokens.is_empty() || lac_check(states, kind, scratch) {
        return kind;
    }
    tokens.iter().copied().find(|&token| lac_check(states, token, scratch)).unwrap_or(kind)
}

/// All tokens that the parser would eventually shift
pub fn collect_expected_symbols(states: &[StateId]) -> Vec<SymbolKind> {
    let mut scratch = Vec::new();
    (0..YYNTOKENS as SymbolKind)
        .filter(|&t| t != S_YYerror && t != S_YYUNDEF && lac_check(states, t, &mut scratch))
        .collect()
}

/// Capture the state stack when the cursor token would be read, and the one when the token before it would be read
struct PrefixCapture<'a> {
    /// The symbol index of the cursor token
    target: u32,
    /// The captured snapshot
    out: &'a mut PrefixSnapshot,
    /// The state stack when the token before the cursor token would be read
    before: Option<Vec<StateId>>,
    /// The shifts until the parser recovered from an error, the `errstatus` of the driver
    recovery: u8,
}

impl Policy for PrefixCapture<'_> {
    fn on_lookahead_read(
        &mut self,
        states: &[StateId],
        _next: &mut SymbolKind,
        pre_index: u32,
        _tokens: &mut Tokens,
        stop: &mut bool,
    ) {
        if self.before.is_none() && self.target.checked_sub(1).is_some_and(|before| pre_index >= before) {
            self.before = Some(states.to_vec());
        }
        if pre_index >= self.target {
            self.out.reached_target = true;
            self.out.recovering = self.recovery > 0;
            self.out.state_stack.extend_from_slice(states);
            *stop = true;
        }
    }
    fn on_shifted(&mut self, _kind: SymbolKind) {
        self.recovery = self.recovery.saturating_sub(1);
    }
    fn on_recover(&mut self) {
        self.recovery = 3;
    }
}

/// Parse until the cursor token and collect the expected symbols there. A keyword right before the cursor counts
/// with each of its lookahead tokens that fits, the token at the cursor decides which one the scanner reads.
pub fn parse_until_with_snapshot(symbols: &[Symbol], target: u32) -> ExpectedAtCursor {
    let mut out = ExpectedAtCursor::default();
    let mut capture = PrefixCapture { target, out: &mut out.prefix, before: None, recovery: 0 };
    drive(&mut capture, &mut vec![0], &mut Tokens { symbols, next_index: 0 });
    let before = capture.before;
    if !out.prefix.reached_target || out.prefix.state_stack.is_empty() {
        return out;
    }
    let previous = target.checked_sub(1).and_then(|i| symbols.get(i as usize)).map(|s| s.kind);
    if let (Some(variants), Some(before)) = (previous.map(token_variants).filter(|v| v.len() > 1), before) {
        for variant in variants {
            let mut states = before.clone();
            if feed(&mut states, variant)
                && states != out.prefix.state_stack
                && !out.prefix.alternatives.contains(&states)
            {
                out.prefix.alternatives.push(states);
            }
        }
    }
    out.expected = collect_expected_symbols(&out.prefix.state_stack);
    for states in &out.prefix.alternatives {
        out.expected.extend(collect_expected_symbols(states));
    }
    out.expected.sort_unstable();
    out.expected.dedup();
    out
}

/// Does the parser take a keyword at the cursor only as a name, like BY in `where a = by`? It does if the state
/// after the keyword shifts nothing and only reduces the keyword to a name. A keyword that also continues a rule of
/// its own, like SET in `update t set` (an alias or the SET clause), is no name only.
pub fn takes_keyword_only_as_name(prefix: &PrefixSnapshot, keyword: SymbolKind) -> bool {
    prefix.reached_target && takes_keyword_only_as_name_at(prefix.stack_for(keyword), keyword)
}

/// Does the parser take a keyword after a stack of states only as a name? See [`takes_keyword_only_as_name`].
#[allow(non_upper_case_globals)]
pub fn takes_keyword_only_as_name_at(states: &[StateId], keyword: SymbolKind) -> bool {
    let mut states = states.to_vec();
    if states.is_empty() || !feed(&mut states, keyword) {
        return false;
    }
    let Some(&state) = states.last() else { return false };
    let is_name_rule = |rule: usize| {
        matches!(
            rule_lhs(rule),
            S_sql_column_name_keywords
                | S_sql_reserved_keywords
                | S_sql_type_func_keywords
                | S_sql_unreserved_keywords
                | S_sql_bare_label_keywords
        )
    };
    let default = default_rule(state);
    if default != 0 && !is_name_rule(default) {
        return false;
    }
    if is_default_state(state) {
        return default != 0;
    }
    (0..YYNTOKENS as SymbolKind).all(|token| match table_action(state, token) {
        Some(Action::Shift(_)) => false,
        Some(Action::Reduce(rule)) => is_name_rule(rule),
        Some(Action::Error) | None => true,
    })
}

/// Replace the cursor token with a symbol, then inject COMPLETE_HERE to collect the expected
/// symbols after it at the next error
struct CollectAfter {
    /// The symbol index of the cursor token
    target: u32,
    /// The symbol that replaces the cursor token
    feed: SymbolKind,
    /// 0 = parsing, 1 = fed the symbol, 2 = injected COMPLETE_HERE
    phase: u8,
    /// The expected symbols after the fed symbol, collected at the first error after COMPLETE_HERE
    expected: Vec<SymbolKind>,
}

impl Policy for CollectAfter {
    fn on_lookahead_read(
        &mut self,
        _states: &[StateId],
        next: &mut SymbolKind,
        pre_index: u32,
        _tokens: &mut Tokens,
        _stop: &mut bool,
    ) {
        if self.phase == 1 {
            *next = S_COMPLETE_HERE;
            self.phase = 2;
            return;
        }
        if self.phase == 0 && pre_index >= self.target {
            *next = self.feed;
            self.phase = 1;
        }
    }
    fn short_circuit_on_error(&mut self, states: &[StateId]) -> bool {
        if self.phase == 2 {
            self.expected = collect_expected_symbols(states);
            return true;
        }
        false
    }
}

/// Parse until the cursor token, feed a symbol instead, and collect the expected symbols after it
pub fn parse_until_after(symbols: &[Symbol], target: u32, feed: SymbolKind) -> Vec<SymbolKind> {
    let mut policy = CollectAfter { target, feed, phase: 0, expected: Vec::new() };
    let mut states = vec![0];
    let mut tokens = Tokens { symbols, next_index: 0 };
    drive(&mut policy, &mut states, &mut tokens);
    policy.expected
}

/// The expected symbols after a keyword fed at the cursor, after the keyword and each of its lookahead tokens that
/// fits there: NOT continues with NULL, and as NOT_LA with BETWEEN, IN, LIKE, ILIKE and SIMILAR. The prefix snapshot
/// gives the state stack, the one of a lookahead token of the keyword before the cursor if only that one takes it.
pub fn expected_after_keyword(
    symbols: &[Symbol],
    target: u32,
    prefix: &PrefixSnapshot,
    keyword: SymbolKind,
) -> Vec<SymbolKind> {
    let mut scratch = Vec::new();
    let mut out = Vec::new();
    for variant in token_variants(keyword) {
        let fits_prefix = prefix.reached_target && lac_check(&prefix.state_stack, variant, &mut scratch);
        if variant == keyword && (fits_prefix || !prefix.reached_target) {
            // The regular stack takes the keyword
            out.extend(parse_until_after(symbols, target, variant));
            continue;
        }
        if !prefix.reached_target {
            continue;
        }
        let mut states = prefix.stack_for(variant).to_vec();
        if feed(&mut states, variant) {
            out.extend(collect_expected_symbols(&states));
        } else if variant == keyword {
            out.extend(parse_until_after(symbols, target, variant));
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// Feed symbols at the cursor and count the real tokens that shift after them
struct SuffixProbePolicy<'a> {
    /// The symbols fed at the cursor
    feed: &'a [SymbolKind],
    /// Does the first fed symbol replace the cursor token instead of being inserted before it?
    replace_target: bool,
    /// The probe result
    probe: SuffixProbe,
    /// The number of fed symbols
    fed_count: usize,
    /// The number of fed symbols that shifted
    feed_shifted: usize,
}

impl Policy for SuffixProbePolicy<'_> {
    fn on_lookahead_read(
        &mut self,
        _states: &[StateId],
        next: &mut SymbolKind,
        pre_index: u32,
        tokens: &mut Tokens,
        _stop: &mut bool,
    ) {
        if let Some(&fed) = self.feed.get(self.fed_count) {
            // Only the first fed symbol replaces the target, all other fed symbols are insertions
            let consumes_target = self.replace_target && self.fed_count == 0;
            if !consumes_target {
                tokens.next_index = pre_index;
            }
            *next = fed;
            self.fed_count += 1;
        }
    }
    fn on_shifted(&mut self, kind: SymbolKind) {
        if self.feed_shifted < self.feed.len() {
            self.feed_shifted += 1;
            return;
        }
        if kind != S_YYEOF {
            if self.probe.depth_consumed == 0 {
                self.probe.k1_compatible = true;
            }
            self.probe.depth_consumed = self.probe.depth_consumed.saturating_add(1);
        }
    }
    fn on_accept(&mut self) {
        self.probe.reached_eof = true;
    }
    fn short_circuit_on_error(&mut self, _states: &[StateId]) -> bool {
        // Recovering would consume the whole suffix without telling anything about the candidate
        self.fed_count >= 1
    }
}

/// Probe a sequence of symbols fed at the cursor against the tokens after it
pub fn probe_suffix_sequence(
    symbols: &[Symbol],
    target: u32,
    prefix: &PrefixSnapshot,
    feed: &[SymbolKind],
    replace_target: bool,
) -> SuffixProbe {
    let Some(&first) = feed.first() else { return SuffixProbe::default() };
    if !prefix.reached_target {
        return SuffixProbe::default();
    }
    let mut states = prefix.stack_for(first).to_vec();
    if states.is_empty() {
        return SuffixProbe::default();
    }
    // A keyword followed by another fed symbol is the lookahead token that the scanner reads before it
    let mut feed = feed.to_vec();
    if let (Some(&next), variants) = (feed.get(1), token_variants(first)) {
        let mut scratch = Vec::new();
        let fits = |variant: SymbolKind, scratch: &mut Vec<StateId>| {
            let mut after = prefix.stack_for(variant).to_vec();
            super::driver::feed(&mut after, variant) && lac_check(&after, next, scratch)
        };
        if variants.len() > 1 && !fits(first, &mut scratch) {
            if let Some(variant) = variants.into_iter().find(|&variant| fits(variant, &mut scratch)) {
                states = prefix.stack_for(variant).to_vec();
                if let Some(slot) = feed.first_mut() {
                    *slot = variant;
                }
            }
        }
    }
    let feed = feed.as_slice();
    // Advance the tokens to the target
    let next_index = target.min(symbols.len() as u32);
    let mut tokens = Tokens { symbols, next_index };
    let mut policy =
        SuffixProbePolicy { feed, replace_target, probe: SuffixProbe::default(), fed_count: 0, feed_shifted: 0 };
    drive(&mut policy, &mut states, &mut tokens);
    policy.probe
}

/// Probe every symbol on its own
pub fn probe_suffix_batch(
    symbols: &[Symbol],
    target: u32,
    prefix: &PrefixSnapshot,
    feed: &[SymbolKind],
    replace_target: bool,
) -> Vec<SuffixProbe> {
    if feed.is_empty() || !prefix.reached_target {
        return vec![SuffixProbe::default(); feed.len()];
    }
    feed.iter().map(|&kind| probe_suffix_sequence(symbols, target, prefix, &[kind], replace_target)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::scan;

    /// The expected symbols at the end of a script
    fn expected_at_end(text: &str) -> ExpectedAtCursor {
        let scanned = scan(text, 0, 0);
        let eof = scanned.symbols.len().saturating_sub(1) as u32;
        parse_until_with_snapshot(&scanned.symbols, eof)
    }

    #[test]
    fn recovers_like_the_parser_at_a_semicolon() {
        // The parser drops the broken statement at its `;` and parses the next one, the probe does the same
        let after_broken = expected_at_end("select (1; create table t (a int, ");
        let alone = expected_at_end("create table t (a int, ");
        assert!(alone.expected.contains(&S_PRIMARY));
        assert_eq!(after_broken.expected, alone.expected);
    }
}
