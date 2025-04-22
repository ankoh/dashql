import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { ChannelArgs } from "../../platform/channel_common.js";
import { KeyValueListElement } from "../../view/foundations/keyvalue_list.js";
import { WorkbookExportSettings } from '../../workbook/workbook_export_settings.js';

export interface HyperGrpcConnectionParams {
    /// The gRPC endpoint
    channelArgs: ChannelArgs;
    /// The attached databases
    attachedDatabases: KeyValueListElement[];
    /// The gRPC metadata
    gRPCMetadata: KeyValueListElement[];
}

export function encodeHyperConnectionParamsAsProto(params: HyperGrpcConnectionParams, _settings: WorkbookExportSettings | null): pb.dashql.connection.ConnectionParams {
    const tls = buf.create(pb.dashql.connection.TlsConfigSchema, {
        clientKeyPath: params.channelArgs.tls?.keyPath,
        clientCertPath: params.channelArgs.tls?.pubPath,
        caCertsPath: params.channelArgs.tls?.caPath,
    });
    return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
        connection: {
            case: "hyper",
            value: buf.create(pb.dashql.connection.HyperConnectionParamsSchema, {
                endpoint: params.channelArgs.endpoint ?? "",
                tls
            })
        }
    });
}

export function readHyperConnectionParamsFromProto(params: pb.dashql.connection.HyperConnectionParams): HyperGrpcConnectionParams {
    const metadata = [];
    for (const k in params.metadata) {
        metadata.push({
            key: k,
            value: params.metadata[k]
        })
    }
    return {
        channelArgs: {
            endpoint: params.endpoint,
        },
        attachedDatabases: params.attachedDatabases.map((a) => ({ key: a.path, value: a.alias })),
        gRPCMetadata: metadata
    };
}

export function createHyperConnectionParamsSignature(params: HyperGrpcConnectionParams): any {
    return {
        case: "hyper",
        channelArgs: {
            endpoint: params.channelArgs.endpoint,
            tls: params.channelArgs.tls
        },
        attachedDatabases: params.attachedDatabases
            .map(d => ({ path: d.key, alias: d.value }))
            .sort((a, b) => a.path > b.path ? 1 : -1),
        gRPCMetadata: params.gRPCMetadata.sort((a, b) => a.key > b.key ? 1 : -1)
    };
}
