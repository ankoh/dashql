// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/ffi_response.h"
#include "dashql/analyzer/analyzer.h"

using namespace dashql;

extern "C" {

void dashql_analyzer_reset() {
    Analyzer::ResetInstance();
}

void dashql_analyzer_parse_program(FFIResponse* response, const char* text) {
    if (auto rc = Analyzer::GetInstance().ParseProgram(text); !rc) {
        FFIResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
    } else {
        flatbuffers::FlatBufferBuilder builder;
        auto program = Analyzer::GetInstance().PackProgram(builder);
        builder.Finish(program);
        FFIResponseBuffer::GetInstance().Store(*response, builder.Release());
    }
}

void dashql_analyzer_instantiate_program(FFIResponse* response, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::analyzer::ProgramParameters>(args_buffer);
    std::vector<ParameterValue> params;
    if (auto values = args->values(); values && values->size() > 0) {
        for (unsigned i = 0; i < args->values()->size(); ++i) {
            params.push_back(ParameterValue::UnPack(*values->Get(i)));
        }
    }
    auto signal = Analyzer::GetInstance().InstantiateProgram(move(params));
    FFIResponseBuffer::GetInstance().Store(*response, std::move(signal));
}

void dashql_analyzer_plan_program(FFIResponse* response) {
    if (auto rc = Analyzer::GetInstance().PlanProgram(); !rc) {
        FFIResponseBuffer::GetInstance().Store(*response, std::move(rc.ReleaseError()));
    } else {
        flatbuffers::FlatBufferBuilder builder;
        auto program = Analyzer::GetInstance().PackPlan(builder);
        builder.Finish(program);
        FFIResponseBuffer::GetInstance().Store(*response, builder.Release());

    }
}

}
