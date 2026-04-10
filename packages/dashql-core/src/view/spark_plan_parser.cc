#include <array>
#include <cctype>
#include <cstring>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/view/plan_view_model.h"
#include "frozen/bits/elsa_std.h"
#include "frozen/unordered_map.h"
#include "frozen/unordered_set.h"

namespace dashql {

namespace {

using namespace std::literals::string_view_literals;

std::string_view TrimWhitespace(std::string_view text) {
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front()))) {
        text.remove_prefix(1);
    }
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back()))) {
        text.remove_suffix(1);
    }
    return text;
}

bool ConsumeSparkPrefix(std::string_view& text) {
    auto trimmed = TrimWhitespace(text);
    if (trimmed.empty()) {
        text = trimmed;
        return false;
    }

    size_t begin = 0;
    if (trimmed[begin] == '*') {
        ++begin;
    }
    if (begin >= trimmed.size() || trimmed[begin] != '(') {
        text = trimmed;
        return false;
    }
    ++begin;
    size_t digits_begin = begin;
    while (begin < trimmed.size() && std::isdigit(static_cast<unsigned char>(trimmed[begin]))) {
        ++begin;
    }
    if (begin == digits_begin || begin >= trimmed.size() || trimmed[begin] != ')') {
        text = trimmed;
        return false;
    }
    ++begin;
    text = TrimWhitespace(trimmed.substr(begin));
    return true;
}

std::pair<size_t, std::string_view> ParseSparkLine(std::string_view line) {
    size_t offset = 0;
    while (offset + 3 <= line.size()) {
        auto group = line.substr(offset, 3);
        if (group == "   "sv || group == ":  "sv || group == "|  "sv) {
            offset += 3;
            continue;
        }
        if (group == "+- "sv || group == ":- "sv) {
            return {offset / 3, TrimWhitespace(line.substr(offset + 3))};
        }
        break;
    }
    return {0, TrimWhitespace(line)};
}

std::pair<std::optional<std::string_view>, std::optional<std::string_view>> ExtractSparkOperator(
    std::string_view content) {
    auto trimmed = TrimWhitespace(content);
    while (ConsumeSparkPrefix(trimmed)) {
    }
    if (trimmed.empty()) {
        return {std::nullopt, std::nullopt};
    }

    if (trimmed.starts_with("Execute "sv)) {
        auto suffix = trimmed.substr(std::char_traits<char>::length("Execute "));
        auto next_space = suffix.find(' ');
        if (next_space != std::string_view::npos) {
            auto op_type = TrimWhitespace(trimmed.substr(0, std::char_traits<char>::length("Execute ") + next_space));
            auto label = TrimWhitespace(suffix.substr(next_space));
            return {op_type, label.empty() ? std::nullopt : std::optional{label}};
        }
    }

    size_t boundary = 0;
    while (boundary < trimmed.size() && trimmed[boundary] != ' ' && trimmed[boundary] != '(' && trimmed[boundary] != '[') {
        ++boundary;
    }
    auto op_type = trimmed.substr(0, boundary);
    std::string_view label;
    if (boundary < trimmed.size() && (trimmed[boundary] == '(' || trimmed[boundary] == '[')) {
        label = TrimWhitespace(trimmed.substr(boundary + 1));
    } else {
        label = TrimWhitespace(trimmed.substr(boundary));
    }
    return {op_type.empty() ? std::nullopt : std::optional{op_type},
            label.empty() ? std::nullopt : std::optional{label}};
}

enum class KnownSparkPipelineBehavior {
    BreaksAll,
    Passthrough,
};

// clang-format off
constexpr auto SPARK_PIPELINE_BEHAVIOR_ENTRIES = std::array{
    std::pair{"AQEShuffleRead"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"BatchScan"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"BroadcastExchange"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"BroadcastHashJoin"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"Exchange"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"Expand"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"FileScan"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"Filter"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"HashAggregate"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"LocalTableScan"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"Project"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"ReusedExchange"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"Sort"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"SortAggregate"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"SortMergeJoin"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"SubqueryBroadcast"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"TakeOrderedAndProject"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"Union"sv, KnownSparkPipelineBehavior::Passthrough},
    std::pair{"Window"sv, KnownSparkPipelineBehavior::BreaksAll},
    std::pair{"WriteFiles"sv, KnownSparkPipelineBehavior::BreaksAll},
};

constexpr auto SPARK_PIPELINE_LAUNCHERS_ENTRIES = std::array{
    "BroadcastExchange"sv,
    "Exchange"sv,
    "HashAggregate"sv,
    "ReusedExchange"sv,
    "Sort"sv,
    "SortAggregate"sv,
    "SubqueryBroadcast"sv,
    "TakeOrderedAndProject"sv,
    "Window"sv,
    "WriteFiles"sv,
};

frozen::unordered_map<std::string_view, KnownSparkPipelineBehavior, std::size(SPARK_PIPELINE_BEHAVIOR_ENTRIES)>
    SPARK_PIPELINE_BEHAVIOR{SPARK_PIPELINE_BEHAVIOR_ENTRIES};
frozen::unordered_set<std::string_view, std::size(SPARK_PIPELINE_LAUNCHERS_ENTRIES)> SPARK_PIPELINE_LAUNCHERS{
    SPARK_PIPELINE_LAUNCHERS_ENTRIES};
// clang-format on

}  // namespace

void PlanViewModel::ParseSparkPlan(std::string_view plan, std::unique_ptr<char[]> plan_buffer) {
    ChunkBuffer<ParsedOperatorNode> parsed_operators;
    Reset();

    if (plan_buffer) {
        input_buffer = std::move(plan_buffer);
    } else {
        input_buffer = std::make_unique<char[]>(plan.size() + 1);
        std::memcpy(input_buffer.get(), plan.data(), plan.size());
        input_buffer[plan.size()] = 0;
    }

    std::string_view input_text{input_buffer.get(), plan.size()};
    std::vector<std::reference_wrapper<ParsedOperatorNode>> root_operators;
    std::vector<std::reference_wrapper<ParsedOperatorNode>> operator_stack;
    size_t child_edge_count = 0;

    size_t line_begin = 0;
    while (line_begin <= input_text.size()) {
        size_t line_end = input_text.find('\n', line_begin);
        if (line_end == std::string_view::npos) {
            line_end = input_text.size();
        }
        auto raw_line = input_text.substr(line_begin, line_end - line_begin);
        if (!raw_line.empty() && raw_line.back() == '\r') {
            raw_line.remove_suffix(1);
        }
        auto trimmed_line = TrimWhitespace(raw_line);
        if (!trimmed_line.empty() && !trimmed_line.starts_with("=="sv)) {
            auto [depth, content] = ParseSparkLine(raw_line);
            auto [operator_type, operator_label] = ExtractSparkOperator(content);
            if (operator_type.has_value()) {
                if (depth > operator_stack.size()) {
                    depth = operator_stack.size();
                }
                while (operator_stack.size() > depth) {
                    operator_stack.pop_back();
                }

                std::optional<buffers::parser::Location> source_location = std::nullopt;
                if (!content.empty()) {
                    auto offset = static_cast<uint32_t>(content.data() - input_buffer.get());
                    source_location = buffers::parser::Location(offset, static_cast<uint32_t>(content.size()));
                }

                auto& parsed = parsed_operators.PushBack(ParsedOperatorNode{
                    {},
                    trimmed_line,
                    operator_type,
                    operator_label,
                    {},
                    {},
                    source_location,
                });

                if (operator_stack.empty()) {
                    root_operators.push_back(parsed);
                } else {
                    operator_stack.back().get().child_operators.PushBack(parsed);
                    child_edge_count += 1;
                }
                operator_stack.push_back(parsed);
            }
        }

        if (line_end == input_text.size()) {
            break;
        }
        line_begin = line_end + 1;
    }

    fragments.emplace_back();
    FlattenOperators(std::move(parsed_operators), std::move(root_operators));
    IdentifyOperatorEdges(operators, child_edge_count);
    IdentifySparkStages();
}

void PlanViewModel::IdentifySparkStages() {
    size_t next_edge_id = 0;

    for (size_t i = 0; i < operators.size(); ++i) {
        auto& op = operators[i];
        if (!op.parent_operator_id.has_value()) {
            continue;
        }
        auto& parent_op = operators[op.parent_operator_id.value()];

        for (auto& pipeline : op.inbound_pipelines) {
            bool pipeline_broken = false;
            for (auto& [k, v] : pipeline.get().edges) {
                auto& [from, to] = k;
                if (to == op.operator_id && v.parent_breaks_pipeline()) {
                    pipeline_broken = true;
                    break;
                }
            }
            if (!pipeline_broken) {
                op.outbound_pipelines.push_back(pipeline);
            }
        }

        bool parent_breaks_pipelines = true;
        if (auto iter = SPARK_PIPELINE_BEHAVIOR.find(parent_op.operator_type.value_or(""));
            iter != SPARK_PIPELINE_BEHAVIOR.end()) {
            parent_breaks_pipelines = iter->second == KnownSparkPipelineBehavior::BreaksAll;
        }

        if (op.child_operators.empty()) {
            op.outbound_pipelines.push_back(RegisterPipeline());
        } else if (auto iter = SPARK_PIPELINE_LAUNCHERS.find(op.operator_type.value_or(""));
                   iter != SPARK_PIPELINE_LAUNCHERS.end()) {
            op.outbound_pipelines.push_back(RegisterPipeline());
        }

        for (auto& pipeline : op.outbound_pipelines) {
            auto& p = pipeline.get();
            buffers::view::PlanPipelineEdge edge{next_edge_id++, p.pipeline_id, op.operator_id, parent_op.operator_id,
                                                 parent_breaks_pipelines};
            p.edges.insert({{op.operator_id, parent_op.operator_id}, edge});
            parent_op.inbound_pipelines.push_back(pipeline);
        }
    }
}

}  // namespace dashql
