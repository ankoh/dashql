 mod dashql_y {
    #![allow(clippy::type_complexity)]
#[allow(dead_code)] const __GRM_DATA: &[u8] = &[8,0,0,0,8,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,94,10,0,0,0,0,0,0,0,83,116,97,116,101,109,101,110,116,115,9,0,0,0,0,0,0,0,83,116,97,116,101,109,101,110,116,20,0,0,0,0,0,0,0,80,97,114,97,109,101,116,101,114,68,101,99,108,97,114,97,116,105,111,110,13,0,0,0,0,0,0,0,76,111,97,100,83,116,97,116,101,109,101,110,116,16,0,0,0,0,0,0,0,69,120,116,114,97,99,116,83,116,97,116,101,109,101,110,116,14,0,0,0,0,0,0,0,81,117,101,114,121,83,116,97,116,101,109,101,110,116,18,0,0,0,0,0,0,0,86,105,115,117,97,108,105,122,101,83,116,97,116,101,109,101,110,116,8,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,59,1,7,0,0,0,0,0,0,0,100,101,99,108,97,114,101,1,9,0,0,0,0,0,0,0,112,97,114,97,109,101,116,101,114,1,4,0,0,0,0,0,0,0,108,111,97,100,1,7,0,0,0,0,0,0,0,101,120,116,114,97,99,116,1,5,0,0,0,0,0,0,0,113,117,101,114,121,1,9,0,0,0,0,0,0,0,118,105,115,117,97,108,105,122,101,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,59,1,7,0,0,0,0,0,0,0,100,101,99,108,97,114,101,1,9,0,0,0,0,0,0,0,112,97,114,97,109,101,116,101,114,1,4,0,0,0,0,0,0,0,108,111,97,100,1,7,0,0,0,0,0,0,0,101,120,116,114,97,99,116,1,5,0,0,0,0,0,0,0,113,117,101,114,121,1,9,0,0,0,0,0,0,0,118,105,115,117,97,108,105,122,101,0,8,0,0,0,7,0,0,0,13,0,0,0,12,0,0,0,13,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,1,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,2,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,7,0,0,0,2,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,2,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,3,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,4,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,5,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,6,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,8,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,12,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,5,0,0,0,0,0,0,0,2,0,0,0,3,0,0,0,4,0,0,0,5,0,0,0,6,0,0,0,1,0,0,0,0,0,0,0,7,0,0,0,1,0,0,0,0,0,0,0,8,0,0,0,1,0,0,0,0,0,0,0,9,0,0,0,1,0,0,0,0,0,0,0,10,0,0,0,1,0,0,0,0,0,0,0,11,0,0,0,13,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,3,0,0,0,4,0,0,0,5,0,0,0,6,0,0,0,7,0,0,0,0,0,0,0,13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,0,0,0,0,0,0,0,1,13,0,0,0,0,0,0,0,79,107,40,118,101,99,33,40,36,49,63,41,41,1,41,0,0,0,0,0,0,0,108,101,116,32,109,117,116,32,118,101,99,32,61,32,36,49,63,59,32,118,101,99,46,112,117,115,104,40,36,50,63,41,59,32,79,107,40,118,101,99,41,1,40,0,0,0,0,0,0,0,79,107,40,83,116,97,116,101,109,101,110,116,58,58,80,97,114,97,109,101,116,101,114,68,101,99,108,97,114,97,116,105,111,110,40,36,49,63,41,41,1,33,0,0,0,0,0,0,0,79,107,40,83,116,97,116,101,109,101,110,116,58,58,76,111,97,100,83,116,97,116,101,109,101,110,116,40,36,49,63,41,41,1,36,0,0,0,0,0,0,0,79,107,40,83,116,97,116,101,109,101,110,116,58,58,69,120,116,114,97,99,116,83,116,97,116,101,109,101,110,116,40,36,49,63,41,41,1,34,0,0,0,0,0,0,0,79,107,40,83,116,97,116,101,109,101,110,116,58,58,81,117,101,114,121,83,116,97,116,101,109,101,110,116,40,36,49,63,41,41,1,38,0,0,0,0,0,0,0,79,107,40,83,116,97,116,101,109,101,110,116,58,58,86,105,115,117,97,108,105,122,101,83,116,97,116,101,109,101,110,116,40,36,49,63,41,41,1,68,0,0,0,0,0,0,0,79,107,40,80,97,114,97,109,101,116,101,114,68,101,99,108,97,114,97,116,105,111,110,32,123,32,108,111,99,97,116,105,111,110,58,32,40,36,49,63,44,32,36,50,63,41,46,105,110,116,111,40,41,44,32,95,100,117,109,109,121,58,32,34,34,32,125,41,1,54,0,0,0,0,0,0,0,79,107,40,76,111,97,100,83,116,97,116,101,109,101,110,116,32,123,32,108,111,99,97,116,105,111,110,58,32,36,49,63,46,105,110,116,111,40,41,44,32,95,100,117,109,109,121,58,32,34,34,32,125,41,1,57,0,0,0,0,0,0,0,79,107,40,69,120,116,114,97,99,116,83,116,97,116,101,109,101,110,116,32,123,32,108,111,99,97,116,105,111,110,58,32,36,49,63,46,105,110,116,111,40,41,44,32,95,100,117,109,109,121,58,32,34,34,32,125,41,1,55,0,0,0,0,0,0,0,79,107,40,81,117,101,114,121,83,116,97,116,101,109,101,110,116,32,123,32,108,111,99,97,116,105,111,110,58,32,36,49,63,46,105,110,116,111,40,41,44,32,95,100,117,109,109,121,58,32,34,34,32,125,41,1,59,0,0,0,0,0,0,0,79,107,40,86,105,115,117,97,108,105,122,101,83,116,97,116,101,109,101,110,116,32,123,32,108,111,99,97,116,105,111,110,58,32,36,49,63,46,105,110,116,111,40,41,44,32,95,100,117,109,109,121,58,32,34,34,32,125,41,0,1,31,0,0,0,0,0,0,0,117,115,101,32,99,114,97,116,101,58,58,112,97,114,115,101,114,58,58,99,111,110,116,101,120,116,58,58,42,59,10,8,0,0,0,0,0,0,0,0,1,31,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,86,101,99,60,83,116,97,116,101,109,101,110,116,60,39,105,110,112,117,116,62,62,62,1,26,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,83,116,97,116,101,109,101,110,116,60,39,105,110,112,117,116,62,62,1,37,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,80,97,114,97,109,101,116,101,114,68,101,99,108,97,114,97,116,105,111,110,60,39,105,110,112,117,116,62,62,1,30,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,76,111,97,100,83,116,97,116,101,109,101,110,116,60,39,105,110,112,117,116,62,62,1,33,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,69,120,116,114,97,99,116,83,116,97,116,101,109,101,110,116,60,39,105,110,112,117,116,62,62,1,31,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,81,117,101,114,121,83,116,97,116,101,109,101,110,116,60,39,105,110,112,117,116,62,62,1,35,0,0,0,0,0,0,0,80,114,111,100,117,99,101,60,86,105,115,117,97,108,105,122,101,83,116,97,116,101,109,101,110,116,60,39,105,110,112,117,116,62,62,0,];
#[allow(dead_code)] const __STABLE_DATA: &[u8] = &[17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,7,0,0,0,0,0,0,0,16,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,0,0,0,0,0,0,0,23,0,0,0,0,0,0,0,24,0,0,0,0,0,0,0,25,0,0,0,0,0,0,0,26,0,0,0,0,0,0,0,27,0,0,0,0,0,0,0,28,0,0,0,0,0,0,0,29,0,0,0,0,0,0,0,30,0,0,0,0,0,0,0,7,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,136,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,133,254,254,251,0,0,0,0,254,5,254,254,0,0,0,0,254,254,254,254,0,0,0,0,254,254,254,5,0,0,0,0,5,0,0,0,0,0,0,0,38,0,0,0,0,0,0,0,9,0,0,0,0,0,0,0,148,146,52,44,0,0,0,0,4,131,86,172,0,0,0,0,64,32,16,212,0,0,0,0,24,52,6,129,0,0,0,0,158,193,96,48,0,0,0,0,18,153,20,142,0,0,0,0,128,160,71,229,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,136,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,122,1,1,4,0,0,0,0,1,250,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,250,0,0,0,0,250,0,0,0,0,0,0,0,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,136,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,1,255,255,255,0,0,0,0,255,3,255,255,0,0,0,0,255,255,255,255,0,0,0,0,255,255,255,255,0,0,0,0,255,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,37,131,121,6,0,0,0,0,0,37,131,249,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,221,0,0,0,0,0,0,0,7,0,0,0,0,0,0,0,0,0,4,64,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,64,0,0,0,0,0,4,0,64,0,0,0,0,0,4,0,4,0,0,0,0,64,0,1,0,0,0,0,0,8,0,2,0,0,0,0,0,136,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,122,0,0,4,0,0,0,0,0,122,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,17,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,150,191,1,0,0,0,0,0,13,0,0,0,8,0,0,0,0,5,0,];

    #[allow(dead_code)]
    pub fn parse<'lexer, 'input: 'lexer>(lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>)
          -> (::std::option::Option<Produce<Vec<Statement<'input>>>>, ::std::vec::Vec<::lrpar::LexParseError<u32>>)
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
        actions.push(&__gt_wrapper_3);
        actions.push(&__gt_wrapper_4);
        actions.push(&__gt_wrapper_5);
        actions.push(&__gt_wrapper_6);
        actions.push(&__gt_wrapper_7);
        actions.push(&__gt_wrapper_8);
        actions.push(&__gt_wrapper_9);
        actions.push(&__gt_wrapper_10);
        actions.push(&__gt_wrapper_11);
        actions.push(&__gt_wrapper_12);

        match ::lrpar::RTParserBuilder::new(&grm, &stable)
            .recoverer(::lrpar::RecoveryKind::None)
            .parse_actions(lexer, &actions) {
                (Some(__GTActionsKind::AK1(x)), y) => (Some(x), y),
                (None, y) => (None, y),
                _ => unreachable!()
        }
    }

    #[allow(dead_code)]
    pub const R_STATEMENTS: u32 = 1;
    #[allow(dead_code)]
    pub const R_STATEMENT: u32 = 2;
    #[allow(dead_code)]
    pub const R_PARAMETERDECLARATION: u32 = 3;
    #[allow(dead_code)]
    pub const R_LOADSTATEMENT: u32 = 4;
    #[allow(dead_code)]
    pub const R_EXTRACTSTATEMENT: u32 = 5;
    #[allow(dead_code)]
    pub const R_QUERYSTATEMENT: u32 = 6;
    #[allow(dead_code)]
    pub const R_VISUALIZESTATEMENT: u32 = 7;
    const __GT_EPP: &[::std::option::Option<&str>] = &[Some(";"), Some("declare"), Some("parameter"), Some("load"), Some("extract"), Some("query"), Some("visualize"), None];

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
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK2(x)) => x,
            _ => unreachable!()
        };
        let __gt_arg_2 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::Lexeme(l) => {
                if l.inserted() {
                    Err(l)
                } else {
                    Ok(l)
                }
            },
            ::lrpar::parser::AStackType::ActionType(_) => unreachable!()
        };
        __GTActionsKind::AK1(__gt_action_0(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1, __gt_arg_2))
    }

    fn __gt_wrapper_1<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK1(x)) => x,
            _ => unreachable!()
        };
        let __gt_arg_2 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK2(x)) => x,
            _ => unreachable!()
        };
        let __gt_arg_3 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::Lexeme(l) => {
                if l.inserted() {
                    Err(l)
                } else {
                    Ok(l)
                }
            },
            ::lrpar::parser::AStackType::ActionType(_) => unreachable!()
        };
        __GTActionsKind::AK1(__gt_action_1(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1, __gt_arg_2, __gt_arg_3))
    }

    fn __gt_wrapper_2<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK3(x)) => x,
            _ => unreachable!()
        };
        __GTActionsKind::AK2(__gt_action_2(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_3<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK4(x)) => x,
            _ => unreachable!()
        };
        __GTActionsKind::AK2(__gt_action_3(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_4<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK5(x)) => x,
            _ => unreachable!()
        };
        __GTActionsKind::AK2(__gt_action_4(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_5<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK6(x)) => x,
            _ => unreachable!()
        };
        __GTActionsKind::AK2(__gt_action_5(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_6<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {
        let __gt_arg_1 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::ActionType(__GTActionsKind::AK7(x)) => x,
            _ => unreachable!()
        };
        __GTActionsKind::AK2(__gt_action_6(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_7<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
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
        let __gt_arg_2 = match __gt_args.next().unwrap() {
            ::lrpar::parser::AStackType::Lexeme(l) => {
                if l.inserted() {
                    Err(l)
                } else {
                    Ok(l)
                }
            },
            ::lrpar::parser::AStackType::ActionType(_) => unreachable!()
        };
        __GTActionsKind::AK3(__gt_action_7(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1, __gt_arg_2))
    }

    fn __gt_wrapper_8<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
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
        __GTActionsKind::AK4(__gt_action_8(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_9<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
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
        __GTActionsKind::AK5(__gt_action_9(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_10<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
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
        __GTActionsKind::AK6(__gt_action_10(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_11<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
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
        __GTActionsKind::AK7(__gt_action_11(__gt_ridx, __gt_lexer, __gt_span, __gt_arg_1))
    }

    fn __gt_wrapper_12<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                      __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                      __gt_span: ::lrpar::Span,
                      mut __gt_args: ::std::vec::Drain<::lrpar::parser::AStackType<__GTActionsKind<'input>, u32>>)
                   -> __GTActionsKind<'input> {    unreachable!()
    }

    #[allow(dead_code)]
    enum __GTActionsKind<'input> {
        AK1(Produce<Vec<Statement<'input>>>),
        AK2(Produce<Statement<'input>>),
        AK3(Produce<ParameterDeclaration<'input>>),
        AK4(Produce<LoadStatement<'input>>),
        AK5(Produce<ExtractStatement<'input>>),
        AK6(Produce<QueryStatement<'input>>),
        AK7(Produce<VisualizeStatement<'input>>),
    ___GTActionsKindHidden(::std::marker::PhantomData<&'input ()>)
    }


// User code from the program section

use crate::parser::context::*;

    // User actions

    // Statements
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_0<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<Statement<'input>>,
                     mut __gt_arg_2: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<Vec<Statement<'input>>> {
Ok(vec!(__gt_arg_1?))
    }

    // Statements
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_1<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<Vec<Statement<'input>>>,
                     mut __gt_arg_2: Produce<Statement<'input>>,
                     mut __gt_arg_3: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<Vec<Statement<'input>>> {
let mut vec = __gt_arg_1?; vec.push(__gt_arg_2?); Ok(vec)
    }

    // Statement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_2<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<ParameterDeclaration<'input>>) 
->                  Produce<Statement<'input>> {
Ok(Statement::ParameterDeclaration(__gt_arg_1?))
    }

    // Statement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_3<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<LoadStatement<'input>>) 
->                  Produce<Statement<'input>> {
Ok(Statement::LoadStatement(__gt_arg_1?))
    }

    // Statement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_4<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<ExtractStatement<'input>>) 
->                  Produce<Statement<'input>> {
Ok(Statement::ExtractStatement(__gt_arg_1?))
    }

    // Statement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_5<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<QueryStatement<'input>>) 
->                  Produce<Statement<'input>> {
Ok(Statement::QueryStatement(__gt_arg_1?))
    }

    // Statement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_6<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: Produce<VisualizeStatement<'input>>) 
->                  Produce<Statement<'input>> {
Ok(Statement::VisualizeStatement(__gt_arg_1?))
    }

    // ParameterDeclaration
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_7<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>,
                     mut __gt_arg_2: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<ParameterDeclaration<'input>> {
Ok(ParameterDeclaration { location: (__gt_arg_1?, __gt_arg_2?).into(), _dummy: "" })
    }

    // LoadStatement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_8<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<LoadStatement<'input>> {
Ok(LoadStatement { location: __gt_arg_1?.into(), _dummy: "" })
    }

    // ExtractStatement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_9<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<ExtractStatement<'input>> {
Ok(ExtractStatement { location: __gt_arg_1?.into(), _dummy: "" })
    }

    // QueryStatement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_10<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<QueryStatement<'input>> {
Ok(QueryStatement { location: __gt_arg_1?.into(), _dummy: "" })
    }

    // VisualizeStatement
    #[allow(clippy::too_many_arguments)]
    fn __gt_action_11<'lexer, 'input: 'lexer>(__gt_ridx: ::cfgrammar::RIdx<u32>,
                     __gt_lexer: &'lexer dyn ::lrpar::NonStreamingLexer<'input, u32>,
                     __gt_span: ::lrpar::Span,
                     mut __gt_arg_1: ::std::result::Result<::lrpar::Lexeme<u32>, ::lrpar::Lexeme<u32>>) 
->                  Produce<VisualizeStatement<'input>> {
Ok(VisualizeStatement { location: __gt_arg_1?.into(), _dummy: "" })
    }

}


/* CACHE INFORMATION
   Build time: "2020-10-02T04:48:49.536067667+00:00"
   Mod name: None
   Recoverer: None
   YaccKind: Some(Grmtools)
   Error on conflicts: true
   0 ';'
   1 'declare'
   2 'parameter'
   3 'load'
   4 'extract'
   5 'query'
   6 'visualize'
   7 <unknown>
*/
