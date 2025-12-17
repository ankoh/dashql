import * as buf from "@bufbuild/protobuf";
import * as pb from "@ankoh/dashql-protobuf";

import getPkceImport from 'oauth-pkce';
export const getPkce = getPkceImport as unknown as typeof getPkceImport.default;

// Generate PKCE challenge
export function generatePKCEChallenge(): Promise<pb.dashql.auth.OAuthPKCEChallenge> {
    return new Promise<pb.dashql.auth.OAuthPKCEChallenge>((resolve, reject) => {
        getPkce(64, (error: any, { verifier, challenge }: any) => {
            if (error != null) {
                reject(error);
            } else {
                const proto = buf.create(pb.dashql.auth.OAuthPKCEChallengeSchema, {
                    value: challenge,
                    verifier
                });
                resolve(proto);
            }
        });
    });
}
