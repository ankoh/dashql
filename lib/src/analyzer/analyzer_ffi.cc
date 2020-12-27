// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/ffi_response.h"
#include "dashql/analyzer/analyzer.h"

using namespace dashql;

extern "C" {

void dashql_analyzer_reset() {
    Analyzer::ResetInstance();
}

void dashql_analyzer_parse_program(FFIResponse* response, const char* text) {
    FFIResponseBuffer::GetInstance().Clear();
    auto program = Analyzer::GetInstance().ParseProgram(text);
    FFIResponseBuffer::GetInstance().Store(*response, std::move(program));
}

void dashql_analyzer_instantiate_program(FFIResponse* response, const void* args_buffer) {
    FFIResponseBuffer::GetInstance().Clear();
    auto* args = flatbuffers::GetRoot<proto::analyzer::ProgramParameters>(args_buffer);
    proto::analyzer::ProgramParametersT unpackedArgs;
    args->UnPackTo(&unpackedArgs);
    auto signal = Analyzer::GetInstance().InstantiateProgram(unpackedArgs);
    FFIResponseBuffer::GetInstance().Store(*response, std::move(signal));
}

void dashql_analyzer_plan_program(FFIResponse* response) {
    FFIResponseBuffer::GetInstance().Clear();
    auto plan = Analyzer::GetInstance().PlanProgram();
    FFIResponseBuffer::GetInstance().Store(*response, std::move(plan));
}

}
