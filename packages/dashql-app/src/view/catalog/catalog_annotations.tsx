
export enum AnnotationTag {
    None = 0,
    HasRestriction = 1,
    HasProjection = 2,
}
export type AnnotationTags = number;

export class CatalogAnnotationProvider {

    public getTableAnnotationTags(): AnnotationTags {
        return 0;
    }
    public getColumnAnnotationTags(): AnnotationTags {
        return 0;
    }
}
