// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"
#include "dashql/common/ffi_response.h"

using namespace dashql;

extern "C" {

void dashql_analyzer_reset() { Analyzer::ResetInstance(); }

void dashql_analyzer_parse_program(FFIResponse* response, const char* text) {
    if (auto rc = Analyzer::GetInstance().ParseProgram(text); !rc) {
        FFIResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto program = Analyzer::GetInstance().PackProgram(builder);
    builder.Finish(program);
    FFIResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_instantiate_program(FFIResponse* response, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::analyzer::ProgramInstantiation>(args_buffer);
    std::vector<ParameterValue> params;
    if (auto values = args->parameters(); values && values->size() > 0) {
        for (unsigned i = 0; i < args->parameters()->size(); ++i) {
            params.push_back(ParameterValue::UnPack(*values->Get(i)));
        }
    }
    if (auto rc = Analyzer::GetInstance().InstantiateProgram(move(params)); !rc) {
        FFIResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto program = Analyzer::GetInstance().PackProgramAnnotations(builder);
    builder.Finish(program);
    FFIResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_plan_program(FFIResponse* response) {
    if (auto rc = Analyzer::GetInstance().PlanProgram(); !rc) {
        FFIResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto program = Analyzer::GetInstance().PackPlan(builder);
    builder.Finish(program);
    FFIResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_edit_program(FFIResponse* response, const void* args_buffer) {
    auto* edit = flatbuffers::GetRoot<proto::edit::ProgramEdit>(args_buffer);
    if (auto rc = Analyzer::GetInstance().EditProgram(*edit); !rc) {
        FFIResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
        return;
    }
    flatbuffers::FlatBufferBuilder builder;
    auto replacement = Analyzer::GetInstance().PackReplacement(builder);
    builder.Finish(replacement);
    FFIResponseBuffer::GetInstance().Store(*response, builder.Release());
}

void dashql_analyzer_update_action_status(uint8_t action_class, size_t action_id, uint8_t status_code) {
    auto ac = static_cast<proto::action::ActionClass>(action_class);
    auto s = static_cast<proto::action::ActionStatusCode>(status_code);
    Analyzer::GetInstance().UpdateActionStatus(ac, action_id, s);
}

}
