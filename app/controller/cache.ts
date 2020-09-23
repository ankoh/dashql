import * as idb from 'idb';

const DB_NAME = 'dashql_idb';
const DB_VERSION = 1;
const CACHE_TABLE = 'cache';

// The cache schema
interface Schema extends idb.DBSchema {
    cache: {
        key: string;
        value: Blob;
    };
}

// A cache controller
export class CacheController {
    // The database
    db: Promise<idb.IDBPDatabase<Schema>>;

    // Constructor
    constructor() {
        if (typeof window === 'undefined') {
            this.db = new Promise(() => {});
        } else {
            this.db = idb.openDB<Schema>(DB_NAME, DB_VERSION, {
                upgrade(db) {
                    if (!db.objectStoreNames.contains(CACHE_TABLE)) {
                        db.createObjectStore(CACHE_TABLE, {
                            keyPath: 'key',
                        });
                    }
                },
            });
        }
    }

    // Get the entry
    public async getEntry(key: string): Promise<Blob | undefined> {
        return (await this.db).get(CACHE_TABLE, key);
    }

    // Set the entry
    public async setEntry(key: string, value: Blob): Promise<string> {
        return (await this.db).put(CACHE_TABLE, value, key);
    }

    // Delete the entry
    public async deleteEntry(key: string): Promise<void> {
        return (await this.db).delete(CACHE_TABLE, key);
    }

    // Clear the entries
    public async clearEntries(): Promise<void> {
        return (await this.db).clear(CACHE_TABLE);
    }

    // Get the entries
    public async getEntries(): Promise<string[]> {
        return (await this.db).getAllKeys(CACHE_TABLE);
    }
}

export default CacheController;
