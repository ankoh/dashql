#include "dashql/formatter/formatter.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using CombineModifier = buffers::parser::CombineModifier;
using CombineOperation = buffers::parser::CombineOperation;
using JoinType = buffers::parser::JoinType;
using NodeType = buffers::parser::NodeType;

namespace {

std::string_view JoinText(JoinType type) {
    switch (type) {
        case JoinType::NONE:
            return "cross join";
        case JoinType::INNER:
            return "join";
        case JoinType::LEFT:
        case JoinType::OUTER_LEFT:
            return "left join";
        case JoinType::RIGHT:
        case JoinType::OUTER_RIGHT:
            return "right join";
        case JoinType::FULL:
        case JoinType::OUTER_FULL:
            return "full join";
        default:
            return {};
    }
}

std::string_view CombineText(CombineOperation operation) {
    switch (operation) {
        case CombineOperation::UNION:
            return "union";
        case CombineOperation::INTERSECT:
            return "intersect";
        case CombineOperation::EXCEPT:
            return "except";
        default:
            return {};
    }
}

std::string_view CombineModifierText(CombineModifier modifier) {
    switch (modifier) {
        case CombineModifier::ALL:
            return "all";
        case CombineModifier::DISTINCT:
            return "distinct";
        default:
            return {};
    }
}

}  // namespace

FmtReg Formatter::FormatPipeFrom(const buffers::parser::Node& node) {
    auto [from] = GetAttributes<AttributeKey::EXT_PIPE_FROM>(node);
    if (!from) return FormatUnimplemented(node);
    auto from_reg = Reg(*from);
    if (from_reg == 0) return FormatUnimplemented(node);
    return config.lower_relational_pipes ? fmt.Concat({fmt.Text("select * from "), from_reg})
                                         : fmt.Concat({fmt.Text("from "), from_reg});
}

FmtReg Formatter::FormatPipeStage(const buffers::parser::Node& node) {
    switch (node.node_type()) {
        case NodeType::OBJECT_EXT_PIPE_WHERE: {
            auto [where] = GetAttributes<AttributeKey::EXT_PIPE_WHERE>(node);
            return where ? fmt.Concat({fmt.Text("where "), Reg(*where)}) : FormatUnimplemented(node);
        }
        case NodeType::OBJECT_EXT_PIPE_SELECT: {
            auto [targets] = GetAttributes<AttributeKey::EXT_PIPE_SELECT_TARGETS>(node);
            return targets ? fmt.Concat({fmt.Text("select "), Reg(*targets)}) : FormatUnimplemented(node);
        }
        case NodeType::OBJECT_EXT_PIPE_EXTEND: {
            auto [targets] = GetAttributes<AttributeKey::EXT_PIPE_EXTEND_TARGETS>(node);
            return targets ? fmt.Concat({fmt.Text("extend "), Reg(*targets)}) : FormatUnimplemented(node);
        }
        case NodeType::OBJECT_EXT_PIPE_AGGREGATE: {
            auto [targets, groups] =
                GetAttributes<AttributeKey::EXT_PIPE_AGGREGATE_TARGETS,
                              AttributeKey::EXT_PIPE_AGGREGATE_GROUPS>(node);
            std::vector<FmtReg> parts{fmt.Text("aggregate")};
            if (targets) parts.push_back(fmt.Concat({fmt.Text(" "), Reg(*targets)}));
            if (groups) parts.push_back(fmt.Concat({fmt.Text(" group by "), Reg(*groups)}));
            return fmt.Concat(std::move(parts));
        }
        case NodeType::OBJECT_EXT_PIPE_DISTINCT:
            return fmt.Text("distinct");
        case NodeType::OBJECT_EXT_PIPE_JOIN: {
            auto [type, input, on, using_] =
                GetAttributes<AttributeKey::EXT_PIPE_JOIN_TYPE, AttributeKey::EXT_PIPE_JOIN_INPUT,
                              AttributeKey::EXT_PIPE_JOIN_ON, AttributeKey::EXT_PIPE_JOIN_USING>(node);
            if (!type || !input) return FormatUnimplemented(node);
            auto join_text = JoinText(static_cast<JoinType>(type->children_begin_or_value()));
            if (join_text.empty()) return FormatUnimplemented(node);
            std::vector<FmtReg> parts{fmt.Text(join_text), fmt.Text(" "), Reg(*input)};
            if (on) parts.push_back(fmt.Concat({fmt.Text(" on "), Reg(*on)}));
            if (using_) parts.push_back(fmt.Concat({fmt.Text(" using "), fmt.Parenthesized(Reg(*using_))}));
            return fmt.Concat(std::move(parts));
        }
        case NodeType::OBJECT_EXT_PIPE_COMBINE: {
            auto [operation, modifier, inputs] =
                GetAttributes<AttributeKey::EXT_PIPE_COMBINE_OPERATION,
                              AttributeKey::EXT_PIPE_COMBINE_MODIFIER,
                              AttributeKey::EXT_PIPE_COMBINE_INPUTS>(node);
            if (!operation || !modifier || !inputs || inputs->node_type() != NodeType::ARRAY) {
                return FormatUnimplemented(node);
            }
            auto operation_text = CombineText(static_cast<CombineOperation>(operation->children_begin_or_value()));
            auto modifier_text = CombineModifierText(static_cast<CombineModifier>(modifier->children_begin_or_value()));
            if (operation_text.empty() || modifier_text.empty()) return FormatUnimplemented(node);
            std::vector<FmtReg> input_regs;
            for (auto& input : GetArrayStates(*inputs)) {
                if (input.reg == 0) return FormatUnimplemented(node);
                input_regs.push_back(fmt.Parenthesized(input.reg));
            }
            auto list = fmt.Join(input_regs, fmt.Text(", "), fmt.Concat({fmt.Text(","), fmt.Break()}));
            return fmt.Concat({fmt.Text(operation_text), fmt.Text(" "), fmt.Text(modifier_text), fmt.Text(" "), list});
        }
        case NodeType::OBJECT_EXT_PIPE_ORDER: {
            auto [order] = GetAttributes<AttributeKey::EXT_PIPE_ORDER>(node);
            return order ? fmt.Concat({fmt.Text("order by "), Reg(*order)}) : FormatUnimplemented(node);
        }
        case NodeType::OBJECT_EXT_PIPE_LIMIT: {
            auto [limit, offset] =
                GetAttributes<AttributeKey::EXT_PIPE_LIMIT, AttributeKey::EXT_PIPE_OFFSET>(node);
            if (!limit) return FormatUnimplemented(node);
            return offset ? fmt.Concat({fmt.Text("limit "), Reg(*limit), fmt.Text(" offset "), Reg(*offset)})
                          : fmt.Concat({fmt.Text("limit "), Reg(*limit)});
        }
        case NodeType::OBJECT_EXT_PIPE_AS: {
            auto [alias] = GetAttributes<AttributeKey::EXT_PIPE_ALIAS>(node);
            return alias ? fmt.Concat({fmt.Text("as "), Reg(*alias)}) : FormatUnimplemented(node);
        }
        default:
            return FormatUnimplemented(node);
    }
}

FmtReg Formatter::FormatPipe(size_t node_id) {
    const auto& node = ast[node_id];
    auto [source, stages] =
        GetAttributes<AttributeKey::EXT_PIPE_SOURCE, AttributeKey::EXT_PIPE_STAGES>(node);
    if (!source || !stages || stages->node_type() != NodeType::ARRAY) return FormatUnimplemented(node);
    auto source_reg = Reg(*source);
    if (source_reg == 0) return FormatUnimplemented(node);

    if (!config.lower_relational_pipes) {
        std::vector<FmtReg> parts{source_reg};
        auto stage_count = stages->children_count();
        if (auto it = pipe_stage_limits.find(node_id); it != pipe_stage_limits.end()) {
            stage_count = std::min<size_t>(stage_count, it->second);
        }
        auto stage_states = GetArrayStates(*stages);
        for (size_t i = 0; i < stage_count; ++i) {
            auto& stage = stage_states[i];
            if (stage.reg == 0) return FormatUnimplemented(node);
            parts.push_back(fmt.Concat({fmt.Text("|> "), stage.reg}));
        }
        auto policy = config.mode == buffers::formatting::FormattingMode::INLINE
                          ? FormattingJoinPolicy::BreakOnOverflow
                          : FormattingJoinPolicy::ForceBreak;
        return fmt.Join(parts, fmt.Text(" "), fmt.Break(), policy);
    }

    auto query = source_reg;
    std::optional<FmtReg> active_alias;
    auto input_relation = [&]() {
        auto alias = active_alias.value_or(fmt.Text("_dashql_pipe"));
        return fmt.Concat({fmt.Parenthesized(query), fmt.Text(" as "), alias});
    };
    auto stage_count = stages->children_count();
    if (auto it = pipe_stage_limits.find(node_id); it != pipe_stage_limits.end()) {
        stage_count = std::min<size_t>(stage_count, it->second);
    }
    for (size_t i = 0; i < stage_count; ++i) {
        const auto& stage = ast[stages->children_begin_or_value() + i];
        auto stage_reg = Reg(stage);
        if (stage_reg == 0) return FormatUnimplemented(node);
        auto input = input_relation();
        switch (stage.node_type()) {
            case NodeType::OBJECT_EXT_PIPE_WHERE:
            {
                auto [where] = GetAttributes<AttributeKey::EXT_PIPE_WHERE>(stage);
                query = fmt.Concat({fmt.Text("select * from "), input, fmt.Text(" where "),
                                    Reg(*where)});
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_SELECT:
            {
                auto [targets] = GetAttributes<AttributeKey::EXT_PIPE_SELECT_TARGETS>(stage);
                query = fmt.Concat({fmt.Text("select "),
                                    Reg(*targets),
                                    fmt.Text(" from "), input});
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_EXTEND:
            {
                auto [targets] = GetAttributes<AttributeKey::EXT_PIPE_EXTEND_TARGETS>(stage);
                query = fmt.Concat({fmt.Text("select *, "),
                                    Reg(*targets),
                                    fmt.Text(" from "), input});
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_DISTINCT:
                query = fmt.Concat({fmt.Text("select distinct * from "), input});
                break;
            case NodeType::OBJECT_EXT_PIPE_ORDER:
            {
                auto [order] = GetAttributes<AttributeKey::EXT_PIPE_ORDER>(stage);
                query = fmt.Concat({fmt.Text("select * from "), input, fmt.Text(" order by "),
                                    Reg(*order)});
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_LIMIT: {
                auto [limit, offset] =
                    GetAttributes<AttributeKey::EXT_PIPE_LIMIT, AttributeKey::EXT_PIPE_OFFSET>(stage);
                query = offset ? fmt.Concat({fmt.Text("select * from "), input, fmt.Text(" limit "), Reg(*limit),
                                             fmt.Text(" offset "), Reg(*offset)})
                               : fmt.Concat({fmt.Text("select * from "), input, fmt.Text(" limit "), Reg(*limit)});
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_AS: {
                auto [alias] = GetAttributes<AttributeKey::EXT_PIPE_ALIAS>(stage);
                active_alias = Reg(*alias);
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_AGGREGATE: {
                auto [targets, groups] =
                    GetAttributes<AttributeKey::EXT_PIPE_AGGREGATE_TARGETS,
                                  AttributeKey::EXT_PIPE_AGGREGATE_GROUPS>(stage);
                std::vector<FmtReg> parts{fmt.Text("select ")};
                if (groups) parts.push_back(Reg(*groups));
                if (targets) {
                    if (groups) parts.push_back(fmt.Text(", "));
                    parts.push_back(Reg(*targets));
                }
                parts.push_back(fmt.Concat({fmt.Text(" from "), input}));
                if (groups) parts.push_back(fmt.Concat({fmt.Text(" group by "), Reg(*groups)}));
                query = fmt.Concat(std::move(parts));
                break;
            }
            case NodeType::OBJECT_EXT_PIPE_JOIN:
                query = fmt.Concat({fmt.Text("select * from "), input, fmt.Text(" "), stage_reg});
                break;
            case NodeType::OBJECT_EXT_PIPE_COMBINE: {
                auto [operation, modifier, inputs] =
                    GetAttributes<AttributeKey::EXT_PIPE_COMBINE_OPERATION,
                                  AttributeKey::EXT_PIPE_COMBINE_MODIFIER,
                                  AttributeKey::EXT_PIPE_COMBINE_INPUTS>(stage);
                auto op = fmt.Concat({fmt.Text(CombineText(static_cast<CombineOperation>(operation->children_begin_or_value()))),
                                      fmt.Text(" "),
                                      fmt.Text(CombineModifierText(static_cast<CombineModifier>(modifier->children_begin_or_value())))});
                std::vector<FmtReg> all_inputs;
                all_inputs.push_back(fmt.Concat({fmt.Text("select * from "), input_relation()}));
                for (size_t input_id = 0; input_id < inputs->children_count(); ++input_id) {
                    const auto& other = ast[inputs->children_begin_or_value() + input_id];
                    auto other_reg = Reg(other);
                    all_inputs.push_back(fmt.Concat(
                        {fmt.Text("select * from "), fmt.Parenthesized(other_reg), fmt.Text(" as _dashql_set")}));
                }
                query = fmt.Join(all_inputs, fmt.Concat({fmt.Text(" "), op, fmt.Text(" ")}),
                                 fmt.Concat({fmt.Break(), op, fmt.Break()}), FormattingJoinPolicy::BreakAllOrNone);
                break;
            }
            default:
                return FormatUnimplemented(stage);
        }
    }
    return query;
}

}  // namespace dashql
