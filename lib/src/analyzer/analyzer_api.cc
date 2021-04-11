// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"
#include "dashql/common/wasm_response.h"

using namespace dashql;

extern "C" {

void dashql_analyzer_reset() { Analyzer::ResetInstance(); }

void dashql_analyzer_parse_program(WASMResponse* response, const char* text) {
    if (auto rc = Analyzer::GetInstance().ParseProgram(text); !rc) {
        WASMResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto program = Analyzer::GetInstance().PackProgram(builder);
    builder.Finish(program);
    WASMResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_instantiate_program(WASMResponse* response, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::analyzer::ProgramInstantiation>(args_buffer);
    std::vector<InputValue> inputs;
    if (auto values = args->input_values(); values && values->size() > 0) {
        for (unsigned i = 0; i < args->input_values()->size(); ++i) {
            inputs.push_back(InputValue::UnPack(*values->Get(i)));
        }
    }
    if (auto rc = Analyzer::GetInstance().InstantiateProgram(move(inputs)); !rc) {
        WASMResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto program = Analyzer::GetInstance().PackProgramAnnotations(builder);
    builder.Finish(program);
    WASMResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_plan_program(WASMResponse* response) {
    if (auto rc = Analyzer::GetInstance().PlanProgram(); !rc) {
        WASMResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto program = Analyzer::GetInstance().PackPlan(builder);
    builder.Finish(program);
    WASMResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_edit_program(WASMResponse* response, const void* args_buffer) {
    auto* edit = flatbuffers::GetRoot<proto::edit::ProgramEdit>(args_buffer);
    if (auto rc = Analyzer::GetInstance().EditProgram(*edit); !rc) {
        WASMResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto replacement = Analyzer::GetInstance().PackReplacement(builder);
    builder.Finish(replacement);
    WASMResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_update_action_status(uint8_t action_class, size_t action_id, uint8_t status_code) {
    auto ac = static_cast<proto::action::ActionClass>(action_class);
    auto s = static_cast<proto::action::ActionStatusCode>(status_code);
    Analyzer::GetInstance().UpdateActionStatus(ac, action_id, s);
}
}
