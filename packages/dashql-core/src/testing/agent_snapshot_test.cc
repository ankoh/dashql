#include "dashql/testing/agent_snapshot_test.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <unordered_map>

#include "c4/yml/std/std.hpp"
#include "dashql/agent/agent_session.h"
#include "dashql/catalog.h"
#include "dashql/testing/runfiles_dir.h"

namespace dashql::testing {
namespace {

using namespace buffers::agent;

struct AgentSnapshotFile {
    std::string content;
    c4::yml::Tree tree;
    std::vector<AgentSnapshotTest> tests;
};

std::unordered_map<std::string, AgentSnapshotFile> TEST_FILES;

std::string ReadText(c4::yml::ConstNodeRef node) {
    if (!node.has_val()) return {};
    auto value = node.val();
    return value.str ? std::string{value.str, value.len} : std::string{};
}

std::string IntentName(AgentIntent intent) { return EnumNameAgentIntent(intent); }
std::string PhaseName(AgentPhase phase) { return EnumNameAgentPhase(phase); }
std::string EffectName(AgentEffectType effect) { return EnumNameAgentEffectType(effect); }
std::string ModelKindName(AgentModelRequestKind kind) { return EnumNameAgentModelRequestKind(kind); }
std::string StatusName(AgentStatus status) { return EnumNameAgentStatus(status); }

void EncodeStrings(c4::yml::NodeRef root, const char* key, const std::vector<std::string>& values) {
    auto node = root.append_child();
    node << c4::yml::key(key);
    node |= c4::yml::SEQ;
    for (const auto& value : values) node.append_child() << value;
}

void EncodeOperation(c4::yml::NodeRef root, const AgentOperationT& operation) {
    auto node = root.append_child();
    node |= c4::yml::MAP;
    node.append_child() << c4::yml::key("status") << StatusName(operation.status);
    if (!operation.status_message.empty()) {
        node.append_child() << c4::yml::key("status-message") << operation.status_message;
    }
    if (operation.snapshot) {
        node.append_child() << c4::yml::key("phase") << PhaseName(operation.snapshot->phase);
        node.append_child() << c4::yml::key("attempt") << operation.snapshot->attempt;
        if (operation.snapshot->intent != AgentIntent::UNKNOWN) {
            node.append_child() << c4::yml::key("intent") << IntentName(operation.snapshot->intent);
        }
    }
    if (operation.effect) {
        auto effect = node.append_child();
        effect << c4::yml::key("effect");
        effect |= c4::yml::MAP;
        effect.append_child() << c4::yml::key("type") << EffectName(operation.effect->type);
        if (operation.effect->model_request) {
            effect.append_child() << c4::yml::key("kind") << ModelKindName(operation.effect->model_request->kind);
            auto prompt = effect.append_child();
            prompt << c4::yml::key("prompt") << operation.effect->model_request->user_prompt;
            prompt.set_val_style(c4::yml::VAL_LITERAL);
            if (!operation.effect->model_request->context.empty()) {
                auto context = effect.append_child();
                context << c4::yml::key("context") << operation.effect->model_request->context;
                context.set_val_style(c4::yml::VAL_LITERAL);
            }
            if (operation.effect->model_request->editing_chart) {
                effect.append_child() << c4::yml::key("editing-chart") << true;
            }
            if (!operation.effect->model_request->previous_candidate.empty()) {
                auto candidate = effect.append_child();
                candidate << c4::yml::key("previous-candidate") << operation.effect->model_request->previous_candidate;
                candidate.set_val_style(c4::yml::VAL_LITERAL);
            }
            if (!operation.effect->model_request->errors.empty()) {
                EncodeStrings(effect, "errors", operation.effect->model_request->errors);
            }
        }
        if (operation.effect->transcode_vegalite) {
            auto raw = effect.append_child();
            raw << c4::yml::key("raw-spec") << operation.effect->transcode_vegalite->raw_spec_json;
            raw.set_val_style(c4::yml::VAL_LITERAL);
        }
        if (operation.effect->apply_proposal && operation.effect->apply_proposal->proposal) {
            effect.append_child() << c4::yml::key("disposition")
                                  << std::string{EnumNameAgentApplyDisposition(
                                         operation.effect->apply_proposal->proposal->disposition)};
            if (!operation.effect->apply_proposal->proposal->target_name.empty()) {
                effect.append_child() << c4::yml::key("target-name")
                                      << operation.effect->apply_proposal->proposal->target_name;
            }
            auto candidate = effect.append_child();
            candidate << c4::yml::key("candidate") << operation.effect->apply_proposal->proposal->candidate_text;
            candidate.set_val_style(c4::yml::VAL_LITERAL);
        }
    }
    for (const auto& event : operation.events) {
        if (!event || event->type != AgentEventType::ATTEMPT_FINISHED || !event->attempt_result) continue;
        auto attempt = node.append_child();
        attempt << c4::yml::key("attempt-result");
        attempt |= c4::yml::MAP;
        auto candidate = attempt.append_child();
        candidate << c4::yml::key("candidate") << event->attempt_result->candidate_text;
        candidate.set_val_style(c4::yml::VAL_LITERAL);
        EncodeStrings(attempt, "errors", event->attempt_result->errors);
    }
    for (const auto& event : operation.events) {
        if (!event || event->type != AgentEventType::FAILED) continue;
        node.append_child() << c4::yml::key("expected-failure") << event->expected_failure;
        node.append_child() << c4::yml::key("error") << event->message;
    }
}

AgentIntent ParseIntent(std::string_view text) {
    if (text == "sql") return AgentIntent::SQL;
    if (text == "visualize") return AgentIntent::VISUALIZE;
    return AgentIntent::UNKNOWN;
}

AgentSnapshotEvent::Type ParseEventType(std::string_view text) {
    if (text == "resolved_context") return AgentSnapshotEvent::Type::kCompleteContext;
    if (text == "transcoded_vegalite") return AgentSnapshotEvent::Type::kCompleteTranscode;
    if (text == "applied_result") return AgentSnapshotEvent::Type::kCompleteApply;
    if (text == "cancel") return AgentSnapshotEvent::Type::kCancel;
    return AgentSnapshotEvent::Type::kCompleteModel;
}

AgentTargetKind ParseTargetKind(std::string_view text) {
    if (text == "sql") return AgentTargetKind::SQL;
    if (text == "visualization") return AgentTargetKind::VISUALIZATION;
    return AgentTargetKind::NONE;
}

}  // namespace

AgentSnapshotTest AgentSnapshotTest::Parse(c4::yml::ConstNodeRef node, bool require_expected) {
    AgentSnapshotTest test;
    if (node.has_child("name")) test.name = ReadText(node["name"]);
    if (node.has_child("input")) {
        auto input = node["input"];
        if (input.has_child("prompt")) test.prompt = ReadText(input["prompt"]);
        if (input.has_child("intent")) test.intent = ParseIntent(ReadText(input["intent"]));
        if (input.has_child("max-attempts")) input["max-attempts"] >> test.max_attempts;
    }
    if (node.has_child("events")) {
        for (auto event_node : node["events"].children()) {
            AgentSnapshotEvent event;
            event.type = ParseEventType(event_node.has_child("type") ? ReadText(event_node["type"])
                                                                     : "model_response");
            if (event_node.has_child("value")) event.value = ReadText(event_node["value"]);
            if (event_node.has_child("target-name")) event.target_name = ReadText(event_node["target-name"]);
            if (event_node.has_child("target-kind")) event.target_kind = ParseTargetKind(ReadText(event_node["target-kind"]));
            if (event_node.has_child("errors")) {
                for (auto error : event_node["errors"].children()) event.errors.push_back(ReadText(error));
            }
            test.events.push_back(std::move(event));
        }
    }
    if (require_expected && !node.has_child("expected")) test.name.clear();
    return test;
}

void AgentSnapshotTest::EncodeExpected(c4::yml::NodeRef root, const AgentSnapshotTest& test) {
    // Drive the same coroutine/effect boundary used by WASM without external services.
    Catalog catalog;
    agent::AgentSession session{catalog};
    AgentStartRequestT request;
    request.user_prompt = test.prompt;
    request.intent_override = test.intent;
    request.max_attempts = test.max_attempts;
    request.read_only = true;

    auto operations = root.append_child();
    operations << c4::yml::key("operations");
    operations |= c4::yml::SEQ;
    auto operation = session.Start(request);
    EncodeOperation(operations, operation);
    for (const auto& event : test.events) {
        if (event.type == AgentSnapshotEvent::Type::kCancel) {
            operation = session.Cancel();
            EncodeOperation(operations, operation);
            continue;
        }
        AgentEffectCompletionT completion;
        completion.effect_id = operation.effect ? operation.effect->id : 0;
        switch (event.type) {
            case AgentSnapshotEvent::Type::kCompleteModel:
                completion.model = std::make_unique<AgentModelCompletionT>();
                completion.model->text = event.value;
                break;
            case AgentSnapshotEvent::Type::kCompleteContext:
                completion.context = std::make_unique<AgentContextResultT>();
                completion.context->context = event.value;
                completion.context->target_kind = event.target_kind;
                completion.context->target_name = event.target_name;
                break;
            case AgentSnapshotEvent::Type::kCompleteTranscode:
                completion.transcode_vegalite = std::make_unique<AgentTranscodeVegaLiteResultT>();
                completion.transcode_vegalite->candidate_text = event.value;
                completion.transcode_vegalite->errors = event.errors;
                break;
            case AgentSnapshotEvent::Type::kCompleteApply:
                completion.apply = std::make_unique<AgentApplyResultT>();
                completion.apply->applied = true;
                break;
            case AgentSnapshotEvent::Type::kCancel:
                break;
        }
        operation = session.CompleteEffect(completion);
        EncodeOperation(operations, operation);
    }
}

void AgentSnapshotTest::LoadTests(const std::filesystem::path& snapshots_dir) {
    if (!TEST_FILES.empty()) return;
    for (auto& path : std::filesystem::directory_iterator(snapshots_dir)) {
        auto filename = path.path().filename().string();
        if (path.path().extension() != ".yaml" || filename.find(".tpl.") != std::string::npos) continue;
        std::ifstream in(path.path(), std::ios::binary);
        if (!in) continue;
        std::stringstream stream;
        stream << in.rdbuf();
        AgentSnapshotFile file;
        file.content = stream.str();
        c4::yml::parse_in_arena(c4::to_csubstr(file.content), &file.tree);
        auto root = file.tree.rootref();
        if (!root.has_child("agent-snapshots")) continue;
        for (auto node : root["agent-snapshots"].children()) {
            auto test = Parse(node, true);
            if (test.name.empty()) continue;
            test.node_id = node.id();
            file.tests.push_back(std::move(test));
        }
        auto [it, _] = TEST_FILES.insert({filename, std::move(file)});
        for (auto& test : it->second.tests) test.tree = &it->second.tree;
    }
}

std::vector<const AgentSnapshotTest*> AgentSnapshotTest::GetTests(std::string_view filename) {
    if (TEST_FILES.empty()) {
        auto root = GetRunfilesSnapshotRoot();
        LoadTests((root.empty() ? std::filesystem::path{"."} : root) / "snapshots" / "agent");
    }
    auto it = TEST_FILES.find(std::string{filename});
    if (it == TEST_FILES.end()) return {};
    std::vector<const AgentSnapshotTest*> out;
    for (auto& test : it->second.tests) out.push_back(&test);
    return out;
}

void operator<<(std::ostream& out, const AgentSnapshotTest& test) { out << test.name; }

}  // namespace dashql::testing
