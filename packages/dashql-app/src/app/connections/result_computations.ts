/// The latest analyzed result of every result owner, e.g. a session script.
///
/// The computation of a result replaces the computation of the owner's previous result once it is
/// analyzed, the previous result stays until then. A result that is analyzed after a later result of
/// the same owner, e.g. of an overlapping rerun, is stale.
export class ResultComputations {
    /// The latest analyzed query of every owner
    private readonly latest = new Map<string, number>();

    /// Register the analyzed result of an owner, returns the computation that is no longer needed
    retain(owner: string, queryId: number): number | null {
        const latest = this.latest.get(owner);
        if (latest !== undefined && latest > queryId) {
            return queryId;
        }
        this.latest.set(owner, queryId);
        return latest ?? null;
    }
}
