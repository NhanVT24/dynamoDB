export interface ManagedProductQuery {
    limit?: number;
    cursor?: string;
    pageLimit?: number;
    maxPages?: number;
    page?: number;
    category?: string;
    status?: string;
    updatedAtFrom?: string;
    searchField?: "name" | "brand";
    search?: string;
    sortBy?: "price" | "stock" | "updatedAt";
    sortDirection?: "asc" | "desc";
}
export interface ManagedProductReads<TItem, TPage, TAll, TCursor> {
    list(query: ManagedProductQuery): Promise<TPage>;
    all(query: ManagedProductQuery): Promise<TAll>;
    cursor(query: ManagedProductQuery): Promise<TCursor>;
    find(id: string): Promise<TItem | null>;
    ownedCandidates(): Promise<Array<{
        ownerId: string;
        item: TItem;
    }>>;
}
export class ManagedProducts<TItem, TPage, TAll, TCursor> {
    constructor(private readonly reads: ManagedProductReads<TItem, TPage, TAll, TCursor>) { }
    list(query: ManagedProductQuery) { return this.reads.list(query); }
    all(query: ManagedProductQuery) { return this.reads.all(query); }
    cursor(query: ManagedProductQuery) { return this.reads.cursor(query); }
    find(id: string) { return this.reads.find(id); }
    async owned(subject: string) { return { items: (await this.reads.ownedCandidates()).filter(entry => entry.ownerId === subject).map(entry => entry.item) }; }
}
