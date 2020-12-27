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
    auto& analyzer = Analyzer::GetInstance();
    auto program = analyzer.ParseProgram(text);
    FFIResponseBuffer::GetInstance().Store(*response, std::move(program));
}

void dashql_analyzer_plan_program(FFIResponse* response, const void* args_buffer) {
    FFIResponseBuffer::GetInstance().Clear();
    auto& analyzer = Analyzer::GetInstance();
    auto* args = flatbuffers::GetRoot<proto::session::PlanArguments>(args_buffer);
    proto::session::PlanArgumentsT unpackedArgs;
    args->UnPackTo(&unpackedArgs);
    auto plan = analyzer.PlanProgram(unpackedArgs);
    FFIResponseBuffer::GetInstance().Store(*response, std::move(plan));
}

}
