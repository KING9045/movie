import { API } from './api';
import { db, DB } from './db';

// Read from Vite env — set VITE_TMDB_API_KEY in frontend/.env
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY;

export const SyncManager = {
    isSyncing: false,
    progress: { current: 0, total: 0, status: 'Idle' },

    async startSync(pages = 1, startPage = 1, onProgress) {
        if (this.isSyncing) return;
        this.isSyncing = true;
        this.progress.total = pages;
        this.progress.status = 'Requesting Backend Sync...';

        for (let i = 0; i < pages; i++) {
            try {
                this.progress.current = i + 1;
                this.progress.status = `Backend Syncing Page...`;
                if (onProgress) onProgress(this.progress);

                const result = await API.triggerBackendSync();
                
                if (result.success && result.count > 0) {
                    // After backend syncs, fetch the latest movies from SQLite and cache in Dexie
                    const backendMovies = await API.getMovies(100, 0);
                    await DB.saveMovies(backendMovies);
                    this.progress.status = `Synced Page ${result.page}`;
                } else {
                    this.progress.status = `No more movies found.`;
                    break;
                }
                
                if (onProgress) onProgress(this.progress);

            } catch (error) {
                console.error(`Backend Sync error:`, error);
                this.progress.status = `Error: ${error.message}`;
                if (onProgress) onProgress(this.progress);
                break;
            }
        }

        this.isSyncing = false;
        this.progress.status = 'Sync Complete';
        if (onProgress) onProgress(this.progress);
    }
};
