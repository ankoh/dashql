// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"
#include "dashql/common/wasm_response.h"

using namespace dashql;

extern "C" {

void dashql_analyzer_reset() { Analyzer::ResetInstance(); }

void dashql_clear_response() { WASMResponseBuffer::Get().Clear(); }

void dashql_analyzer_parse_program(WASMResponse* response, const char* text) {
    if (auto status = Analyzer::GetInstance().ParseProgram(text); !status.ok()) {
        WASMResponseBuffer::Get().Store(*response, status);
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    ASSIGN_OR_RETURN(response, auto program, Analyzer::GetInstance().PackProgram(builder));
    builder.Finish(program);
    WASMResponseBuffer::Get().Store(*response, builder.Release());
}

void dashql_analyzer_instantiate_program(WASMResponse* response, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::analyzer::ProgramInstantiation>(args_buffer);
    std::vector<InputValue> inputs;
    if (auto values = args->input_values(); values && values->size() > 0) {
        for (unsigned i = 0; i < args->input_values()->size(); ++i) {
            // Unpack the input value
            auto maybe_ofs = InputValue::UnPack(*values->Get(i));
            if (!maybe_ofs.ok()) {
                WASMResponseBuffer::Get().Store(*response, std::move(maybe_ofs.status()));
                return;
            }
            inputs.push_back(maybe_ofs.ValueUnsafe());
        }
    }
    if (auto status = Analyzer::GetInstance().InstantiateProgram(move(inputs)); !status.ok()) {
        WASMResponseBuffer::Get().Store(*response, status);
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    ASSIGN_OR_RETURN(response, auto program, Analyzer::GetInstance().PackProgramAnnotations(builder));
    builder.Finish(program);
    WASMResponseBuffer::Get().Store(*response, builder.Release());
}

void dashql_analyzer_plan_program(WASMResponse* response) {
    if (auto status = Analyzer::GetInstance().PlanProgram(); !status.ok()) {
        WASMResponseBuffer::Get().Store(*response, std::move(status));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    ASSIGN_OR_RETURN(response, auto program, Analyzer::GetInstance().PackPlan(builder));
    builder.Finish(program);
    WASMResponseBuffer::Get().Store(*response, builder.Release());
}

void dashql_analyzer_edit_program(WASMResponse* response, const void* args_buffer) {
    auto* edit = flatbuffers::GetRoot<proto::edit::ProgramEdit>(args_buffer);
    if (auto status = Analyzer::GetInstance().EditProgram(*edit); !status.ok()) {
        WASMResponseBuffer::Get().Store(*response, std::move(status));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    ASSIGN_OR_RETURN(response, auto replacement, Analyzer::GetInstance().PackReplacement(builder));
    builder.Finish(replacement);
    WASMResponseBuffer::Get().Store(*response, builder.Release());
}

void dashql_analyzer_update_task_status(uint8_t task_class, size_t task_id, uint8_t status_code) {
    auto ac = static_cast<proto::task::TaskClass>(task_class);
    auto s = static_cast<proto::task::TaskStatusCode>(status_code);
    Analyzer::GetInstance().UpdateTaskStatus(ac, task_id, s).ok();
}
}
