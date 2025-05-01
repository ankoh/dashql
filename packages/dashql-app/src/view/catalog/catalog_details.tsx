import * as dashql from '@ankoh/dashql-core';

export enum AnnotationTag {
    None = 0,
    HasRestriction = 1,
    HasProjection = 2,
}
export type AnnotationTags = number;

export class CatalogAnnotationProvider {

    public getAnnotationTags(_snap: dashql.DashQLCatalogSnapshotReader, _levelId: number, _entryId: number): AnnotationTags {
        return 0;
    }
}
