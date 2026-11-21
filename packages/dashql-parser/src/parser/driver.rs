//! The LALR(1) driver, the `parse()` loop of bison's lalr1.cc skeleton configured with
//! `parse.lac full`, `parse.error verbose` plus an error hint, error recovery through the `error`
//! token, and a custom default location for reductions. The stack has a depth limit
//! (`MAX_STACK_DEPTH`), a shift past it is a syntax error.

use super::actions::{ReduceError, ReduceStack};
use super::context::ParseContext;
use super::value::Value;
use crate::scanner::SymbolValue;
use crate::symbol_kind::*;
use crate::tables::*;
use crate::{symbol_name, SymbolKind};
use dashql_buffers::parser::SymbolSpan;

/// A parser state
pub type StateId = i32;

/// The depth of the parser stack that a shift may not reach. Nesting grows the stack: parentheses, brackets, subqueries,
/// CASE, prefix operators. The parse tree is flat, but the analyzer, the formatter and the checks of client function
/// calls walk parts of it recursively, on the 1 MiB stack of the module, where an overflow traps the module. A token
/// that would nest deeper is a syntax error with `NESTING_TOO_DEEP` that drops the statement: the parser recovers at
/// the bottom of its stack, where the statement began, and skips to the next one. Recovering inside the nesting would
/// leave the stack at the limit, where no closing token could shift.
pub const MAX_STACK_DEPTH: usize = 1000;

/// The error of a token that would nest deeper than `MAX_STACK_DEPTH`
pub const NESTING_TOO_DEEP: &str = "syntax error, the statement nests too deep";

/// A state off the tables, every action on it is an error. The tables hold the states, rules and symbols of the
/// grammar, so their lookups never miss; a miss ends in a syntax error instead of a panic.
pub const NO_STATE: StateId = -1;

/// The default rule of a state, 0 to fail
#[inline(always)]
pub fn default_rule(state: StateId) -> usize {
    YYDEFACT.get(state as usize).map_or(0, |&rule| rule as usize)
}

/// The length of the right-hand side of a rule
#[inline(always)]
pub fn rule_length(rule: usize) -> usize {
    YYR2.get(rule).map_or(0, |&len| len as usize)
}

/// The left-hand side of a rule, a symbol off the tables for an unknown rule
#[inline(always)]
pub fn rule_lhs(rule: usize) -> SymbolKind {
    YYR1.get(rule).map_or(SymbolKind::MAX, |&lhs| lhs as SymbolKind)
}

/// Does a state take its default action without a lookahead?
#[inline(always)]
pub fn is_default_state(state: StateId) -> bool {
    YYPACT.get(state as usize).is_some_and(|&pact| pact == YYPACT_NINF)
}

/// The state `depth` states below the top of a stack, `NO_STATE` below its bottom
#[inline(always)]
pub fn state_below(states: &[StateId], depth: usize) -> StateId {
    states.len().checked_sub(depth + 1).and_then(|i| states.get(i)).copied().unwrap_or(NO_STATE)
}

/// The state of `goto` after reducing to `lhs` in `state` (`yy_lr_goto_state_`)
pub fn goto_state(state: StateId, lhs: SymbolKind) -> StateId {
    let nterm = (lhs as usize).wrapping_sub(YYNTOKENS);
    let (Some(&pgoto), Some(&defgoto)) = (YYPGOTO.get(nterm), YYDEFGOTO.get(nterm)) else {
        return NO_STATE;
    };
    let r = pgoto as i32 + state;
    if (0..=YYLAST).contains(&r) && YYCHECK.get(r as usize).is_some_and(|&check| check as i32 == state) {
        YYTABLE.get(r as usize).map_or(NO_STATE, |&next| next as i32)
    } else {
        defgoto as i32
    }
}

/// The action of a state on a token: `Some(Shift(state))`, `Some(Reduce(rule))`, or `None` for the
/// default action (or an error if the default is to fail).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Shift(StateId),
    Reduce(usize),
    Error,
}

/// The table action of `state` on `token`, `None` if the default action applies
pub fn table_action(state: StateId, token: SymbolKind) -> Option<Action> {
    let Some(&pact) = YYPACT.get(state as usize) else {
        return Some(Action::Error);
    };
    if pact == YYPACT_NINF {
        return None;
    }
    let i = pact + token as i32;
    if !(0..=YYLAST).contains(&i) || YYCHECK.get(i as usize).map(|&check| check as i32) != Some(token as i32) {
        return None;
    }
    let Some(&action) = YYTABLE.get(i as usize) else {
        return Some(Action::Error);
    };
    let action = action as i32;
    Some(if action > 0 {
        Action::Shift(action)
    } else if action == YYTABLE_NINF {
        Action::Error
    } else {
        Action::Reduce(-action as usize)
    })
}

/// Would the parser eventually shift `token` from the given stack of states? (`yy_lac_check_`)
///
/// Simulates the reductions on a scratch stack, the stack itself is not modified.
pub fn lac_check(states: &[StateId], token: SymbolKind, scratch: &mut Vec<StateId>) -> bool {
    scratch.clear();
    // The number of states popped from `states`
    let mut lac_top = 0;
    loop {
        let top_state = match scratch.last() {
            Some(&state) => state,
            None => state_below(states, lac_top),
        };
        let rule = match table_action(top_state, token) {
            Some(Action::Shift(_)) => return true,
            Some(Action::Error) => return false,
            Some(Action::Reduce(rule)) => rule,
            None => match default_rule(top_state) {
                0 => return false,
                rule => rule,
            },
        };
        // Pop the right-hand side, first from the scratch stack
        let mut len = rule_length(rule);
        if len < scratch.len() {
            scratch.truncate(scratch.len() - len);
            len = 0;
        } else if !scratch.is_empty() {
            len -= scratch.len();
            scratch.clear();
        }
        lac_top += len;
        let top_state = match scratch.last() {
            Some(&state) => state,
            None => state_below(states, lac_top),
        };
        scratch.push(goto_state(top_state, rule_lhs(rule)));
    }
}

/// Feed a token to a stack of states: reduce until the token is shifted. Returns false (and leaves
/// the stack in an unspecified state) if the token is a syntax error.
pub fn feed(states: &mut Vec<StateId>, token: SymbolKind) -> bool {
    loop {
        let Some(&top) = states.last() else { return false };
        let rule = match table_action(top, token) {
            Some(Action::Shift(next)) => {
                states.push(next);
                return true;
            }
            Some(Action::Error) => return false,
            Some(Action::Reduce(rule)) => rule,
            None => match default_rule(top) {
                0 => return false,
                rule => rule,
            },
        };
        states.truncate(states.len().saturating_sub(rule_length(rule)));
        let Some(&below) = states.last() else { return false };
        states.push(goto_state(below, rule_lhs(rule)));
    }
}

/// The location of the left-hand side of a reduction (bison's `YYLLOC_DEFAULT`).
/// Uses wrapping uint32 arithmetic.
fn default_location(rhs: &[SymbolSpan], below: SymbolSpan) -> SymbolSpan {
    match (rhs.first(), rhs.last()) {
        (Some(first), Some(last)) => {
            SymbolSpan::new(first.offset(), last.offset().wrapping_add(last.length()).wrapping_sub(first.offset()))
        }
        _ => SymbolSpan::new(below.offset().wrapping_add(below.length()), 0),
    }
}

/// A lookahead token
#[derive(Clone, Copy, Debug)]
struct Lookahead {
    /// The token kind
    kind: SymbolKind,
    /// The semantic value of the token
    value: Value,
}

/// The parser stack
struct Stack {
    /// The automaton states
    states: Vec<StateId>,
    /// The semantic values, parallel to the states
    values: Vec<Value>,
    /// The symbol-index locations, parallel to the states
    locations: Vec<SymbolSpan>,
}

impl Stack {
    fn push(&mut self, state: StateId, value: Value, location: SymbolSpan) {
        self.states.push(state);
        self.values.push(value);
        self.locations.push(location);
    }

    fn pop(&mut self, n: usize) {
        let len = self.states.len().saturating_sub(n);
        self.states.truncate(len);
        self.values.truncate(len);
        self.locations.truncate(len);
    }

    fn top(&self) -> StateId {
        self.states.last().copied().unwrap_or(NO_STATE)
    }
}

// The actions of a rule read only the symbols of its right-hand side, which are on the stack
impl ReduceStack for Stack {
    fn value_at(&self, i: usize) -> Value {
        self.values.len().checked_sub(i + 1).and_then(|i| self.values.get(i)).copied().unwrap_or(Value::Empty)
    }
    fn location_at(&self, i: usize) -> SymbolSpan {
        self.locations.len().checked_sub(i + 1).and_then(|i| self.locations.get(i)).copied().unwrap_or_default()
    }
}

/// The token stream of the parser: scanned symbols located by their
/// index, followed by EOF tokens of length 0 once the symbols are exhausted.
pub struct TokenStream {
    /// The index of the next symbol to return
    pub next_index: u32,
}

impl TokenStream {
    pub fn next(&mut self, ctx: &ParseContext) -> (SymbolKind, Value, SymbolSpan) {
        let index = self.next_index;
        match ctx.symbols().get(index as usize) {
            Some(symbol) => {
                self.next_index += 1;
                let value = match symbol.value {
                    SymbolValue::None => Value::Empty,
                    SymbolValue::Name(id) => Value::Name(id),
                    SymbolValue::Text(text) => Value::Str(text),
                };
                (symbol.kind, value, SymbolSpan::new(index, 1))
            }
            None => (S_YYEOF, Value::Empty, SymbolSpan::new(index, 0)),
        }
    }
}

/// Where the parse loop continues
enum Label {
    NewState,
    Default,
    Reduce(usize),
    ErrLab,
    ErrLab1,
}

/// Build the verbose syntax error message (`yysyntax_error_`) and its hint.
fn syntax_error(states: &[StateId], lookahead: Option<SymbolKind>, scratch: &mut Vec<StateId>) -> (String, String) {
    const ARGS_MAX: usize = 5;
    let Some(token) = lookahead else {
        return ("syntax error".to_string(), String::new());
    };
    let mut args = vec![token];
    let mut overflow = false;
    for t in 0..YYNTOKENS as SymbolKind {
        if t == S_YYerror || t == S_YYUNDEF || !lac_check(states, t, scratch) {
            continue;
        }
        if args.len() == ARGS_MAX {
            overflow = true;
            break;
        }
        args.push(t);
    }
    if overflow {
        args.truncate(1);
    }
    let mut message = format!("syntax error, unexpected {}", symbol_name(token));
    for (i, &arg) in args.iter().enumerate().skip(1) {
        message.push_str(if i == 1 { ", expecting " } else { " or " });
        message.push_str(&symbol_name(arg));
    }
    // Suggest a double-quoted identifier when a string literal is used where an identifier fits.
    let hint = if token == S_SCONST && lac_check(states, S_IDENT, scratch) {
        "string literals cannot be used as identifiers here; use a double-quoted identifier instead".to_string()
    } else {
        String::new()
    };
    (message, hint)
}

/// Run the parser with the grammar actions. Returns false if parsing was aborted.
pub fn parse(ctx: &mut ParseContext) -> bool {
    let mut stack = Stack { states: vec![0], values: vec![Value::Empty], locations: vec![SymbolSpan::default()] };
    let mut tokens = TokenStream { next_index: 0 };
    let mut lookahead: Option<Lookahead> = None;
    // The location of the lookahead; it outlives the lookahead itself, like bison's yyla.location.
    let mut lookahead_location = SymbolSpan::default();
    let mut lac_established = false;
    let mut scratch = Vec::new();
    let mut errstatus = 0;
    let mut error_range_begin = SymbolSpan::default();
    // Did the error come from a shift past the depth limit? Then the recovery unwinds the statement.
    let mut too_deep = false;
    let mut unwind = false;
    let mut label = Label::NewState;

    loop {
        label = match label {
            Label::NewState => {
                let state = stack.top();
                if state == YYFINAL {
                    return true;
                }
                if is_default_state(state) {
                    Label::Default
                } else {
                    let la = match lookahead {
                        Some(la) => la,
                        None => {
                            let (kind, value, location) = tokens.next(ctx);
                            lookahead_location = location;
                            let la = Lookahead { kind, value };
                            lookahead = Some(la);
                            la
                        }
                    };
                    let mut establish = |stack: &Stack| {
                        if !lac_established {
                            lac_established = true;
                            return lac_check(&stack.states, la.kind, &mut scratch);
                        }
                        true
                    };
                    match table_action(state, la.kind) {
                        None => {
                            if establish(&stack) {
                                Label::Default
                            } else {
                                Label::ErrLab
                            }
                        }
                        Some(Action::Error) => Label::ErrLab,
                        Some(Action::Reduce(rule)) => {
                            if establish(&stack) {
                                Label::Reduce(rule)
                            } else {
                                Label::ErrLab
                            }
                        }
                        Some(Action::Shift(_)) if stack.states.len() >= MAX_STACK_DEPTH => {
                            too_deep = true;
                            Label::ErrLab
                        }
                        Some(Action::Shift(next)) => {
                            if errstatus > 0 {
                                errstatus -= 1;
                            }
                            stack.push(next, la.value, lookahead_location);
                            lookahead = None;
                            lac_established = false;
                            Label::NewState
                        }
                    }
                }
            }
            Label::Default => match default_rule(stack.top()) {
                0 => Label::ErrLab,
                rule => Label::Reduce(rule),
            },
            Label::Reduce(rule) => {
                let len = rule_length(rule);
                let lhs_state = goto_state(state_below(&stack.states, len), rule_lhs(rule));
                let n = stack.locations.len();
                let rhs = stack.locations.get(n.saturating_sub(len)..).unwrap_or_default();
                let location = default_location(rhs, stack.locations.last().copied().unwrap_or_default());
                error_range_begin = location;
                match reduce(ctx, rule, &stack, location) {
                    Ok(value) => {
                        // Keep statement separators available to the recovery productions.
                        if std::mem::take(&mut ctx.state.borrow_mut().clear_lookahead)
                            && lookahead.is_none_or(|la| la.kind != S_SEMICOLON)
                        {
                            lookahead = None;
                        }
                        stack.pop(len);
                        stack.push(lhs_state, value.unwrap_or(Value::Empty), location);
                        Label::NewState
                    }
                    Err(ReduceError::YyError) => {
                        // Keep statement separators available to the recovery productions.
                        if std::mem::take(&mut ctx.state.borrow_mut().clear_lookahead)
                            && lookahead.is_none_or(|la| la.kind != S_SEMICOLON)
                        {
                            lookahead = None;
                        }
                        // yyerrorlab: do not reclaim the symbols of the rule
                        stack.pop(len);
                        Label::ErrLab1
                    }
                }
            }
            Label::ErrLab => {
                let deep = std::mem::take(&mut too_deep);
                if errstatus == 0 {
                    let (message, hint) = if deep {
                        (NESTING_TOO_DEEP.to_string(), String::new())
                    } else {
                        syntax_error(&stack.states, lookahead.map(|la| la.kind), &mut scratch)
                    };
                    ctx.state.borrow_mut().pending_hint = hint;
                    ctx.error(lookahead_location, &message);
                }
                unwind |= deep;
                error_range_begin = lookahead_location;
                if errstatus == 3 {
                    // Discard the lookahead that failed to be reused after an error
                    match lookahead {
                        Some(la) if la.kind == S_YYEOF => return false,
                        Some(_) => lookahead = None,
                        None => {}
                    }
                }
                Label::ErrLab1
            }
            Label::ErrLab1 => {
                errstatus = 3;
                // A statement that nests too deep recovers at the lowest state that shifts the error token
                if std::mem::take(&mut unwind) {
                    let bottom = stack
                        .states
                        .iter()
                        .position(|&state| matches!(table_action(state, S_YYerror), Some(Action::Shift(_))));
                    if let Some(bottom) = bottom {
                        error_range_begin = stack.locations.get(bottom + 1).copied().unwrap_or(error_range_begin);
                        stack.pop(stack.states.len().saturating_sub(bottom + 1));
                    }
                }
                // Pop states until one shifts the error token
                let next = loop {
                    if let Some(Action::Shift(next)) = table_action(stack.top(), S_YYerror) {
                        break next;
                    }
                    if stack.states.len() <= 1 {
                        return false;
                    }
                    error_range_begin = stack.locations.last().copied().unwrap_or_default();
                    stack.pop(1);
                };
                let error_location = default_location(&[error_range_begin, lookahead_location], SymbolSpan::default());
                lac_established = false;
                stack.push(next, Value::Empty, error_location);
                Label::NewState
            }
        };
    }
}

/// Run the action of a rule
fn reduce(
    ctx: &mut ParseContext,
    rule: usize,
    stack: &Stack,
    location: SymbolSpan,
) -> Result<Option<Value>, ReduceError> {
    crate::tables::reduce(ctx, rule, stack, location)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_tokens() {
        let mut scratch = Vec::new();
        assert!(lac_check(&[0], S_SELECT, &mut scratch));
        assert!(!lac_check(&[0], S_RRB, &mut scratch));
    }
}
