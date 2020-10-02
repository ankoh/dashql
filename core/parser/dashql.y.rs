 mod dashql_y {
    #![allow(clippy::type_complexity)]
#[allow(dead_code)] const __GRM_DATA: &[u8] = &[2,0,0,0,2,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,94,5,0,0,0,0,0,0,0,83,116,97,114,116,2,0,0,0,0,0,0,0,1,3,0,0,0,0,0,0,0,102,111,111,0,2,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,1,3,0,0,0,0,0,0,0,102,111,111,0,2,0,0,0,1,0,0,0,3,0,0,0,2,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,2,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,2,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,3,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,1,9,0,0,0,0,0,0,0,79,107,40,102,97,108,115,101,41,1,8,0,0,0,0,0,0,0,79,107,40,116,114,117,101,41,0,1,31,0,0,0,0,0,0,0,117,115,101,32,99,114,97,116,101,58,58,112,97,114,115,101,114,58,58,99,111,110,116,101,120,116,58,58,42,59,10,2,0,0,0,0,0,0,0,0,1,13,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,98,111,111,108,62,0,];
#[allow(dead_code)] const __STABLE_DATA: &[u8] = &[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,20,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,16,98,0,0,0,0,3,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,43,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,61,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,48,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,17,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,3,0,0,0,2,0,0,0,0,2,0,];

    #[allow(dead_code)]
    pub fn parse<'lexer, 'input: 'lexer>(lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>)
          -> (::std::option::Option<Produce<bool>>, ::std::vec::Vec<::lrpar::LexParseError<u32>>)
    {
        let (grm, stable) = ::lrpar::ctbuilder::_reconstitute(__GRM_DATA, __STABLE_DATA);
        #[allow(clippy::type_complexity)]
        let mut actions: ::std::vec::Vec<&dyn Fn(::cfgrammar::RIdx<u32>,
                       &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                       ::lrpar::Span,
                       ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                    -> __GTActionsKind<'input>> = ::std::vec::Vec::new();
        actions.push(&__gt_wrapper_0);
        actions.push(&__gt_wrapper_1);
        actions.push(&__gt_wrapper_2);

        match ::lrpar::RTParserBuilder::new(&grm, &stable)
            .recoverer(::lrpar::RecoveryKind::None)
            .parse_actions(lexer, &actions) {
                (Some(__GTActionsKind::AK1(x)), y) => (Some(x), y),
                (None, y) => (None, y),
                _ => unreachable!()
        }
    }

    #[allow(dead_code)]
    pub const R_START: u32 = 1;
    const __GT_EPP: &[::std::option::Option<&str>] = &[Some("foo"), None];

    /// Return the %epp entry for token `tidx` (where `None` indicates "the token has no
    /// pretty-printed value"). Panics if `tidx` doesn't exist.
    #[allow(dead_code)]
    pub fn token_epp<'a>(tidx: ::cfgrammar::TIdx<u32>) -> ::std::option::Option<&'a str> {
        __GT_EPP[usize::from(tidx)]
    }

    // Wrappers

    fn __gt_wrapper_0<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        __GTActionsKind::AK1(__gt_action_0(__gt_ridx, __gt_lexer, __gt_span, ))
    }

    fn __gt_wrapper_1<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::Lexeme(l) => {
                if l.inserted() {
                    Err(l)
                } else {
                    Ok(l)
                }
            },
            ::lrpar::parser::AStackType::ActionType(_) => unreachable!()
        };
        __GTActionsKind::AK1(__gt_action_1(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_2<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {    unreachable!()
    }

    #[allow(dead_code)]
    enum __GTActionsKind<'input> {
        AK1(Produce<bool>),
    ___GTActionsKindHidden(::std::marker::PhantomData<&'input ()>)
    }


// User code from the program section

use crate::parser::context::*;

    // User actions

    // Start
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_0<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     ) 
->                  Produce<bool> {
Ok(false)
    }

    // Start
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_1<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<bool> {
Ok(true)
    }

}


/* CACHE INFORMATION
   Build time: "2020-10-02T04:48:49.536067667+00:00"
   Mod name: None
   Recoverer: None
   YaccKind: Some(Grmtools)
   Error on conflicts: true
   0 'foo'
   1 <unknown>
*/
