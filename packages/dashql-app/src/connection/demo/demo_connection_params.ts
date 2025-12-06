import * as pb from '@ankoh/dashql-protobuf';
export function createDemoConnectionParamsSignature(_params: pb.dashql.connection.DemoParams): any {
    return { case: "demo" };
}
