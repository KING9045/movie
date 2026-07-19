const BACKEND_URL = 'https://movies.caffegelato-arusha.com';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const VIDSRC_BASE = 'https://vsembed.ru/movies/latest/page-';
 
/**
 * Robust cross-platform fetch wrapper
 * Handles CORS via proxy on web and direct native request on Android/TV
 */
export async function smartFetch(url, options = {}) {
    // Check if we are in a native Capacitor environment
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
 
    if (isNative && window.Capacitor.Http) {
        // Use Native HTTP to bypass CORS on Android/TV
        const response = await window.Capacitor.Http.request({
            url: url,
            method: options.method || 'GET',
            headers: options.headers || {},
            data: options.body || {}
        });
        
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Native API Error: ${response.status} for ${url}`);
        }
        return response.data;
    } else {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`Web API Error: ${response.status} for ${url}`);
        }
        return response.json();
    }
}

export const API = {
    async getMovies(page = 1) {
        // Use local backend proxy for Vidsrc
        const url = window.Capacitor?.isNativePlatform() 
            ? `${VIDSRC_BASE}${page}.json` 
            : `${BACKEND_URL}/api/external/vidsrc/${page}`;
        return smartFetch(url);
    },
    
    async searchMovies(query) {
        const response = await fetch(`${BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`);
        return response.json();
    },
    
    async getTMDBMetadata(tmdbId, apiKey) {
        // Use local backend proxy for TMDB
        const url = window.Capacitor?.isNativePlatform()
            ? `${TMDB_API_BASE}/movie/${tmdbId}`
            : `${BACKEND_URL}/api/tmdb/movie/${tmdbId}`;
            
        return smartFetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
    },
    async triggerBackendSync() {
        const response = await fetch(`${BACKEND_URL}/api/sync/more`, { method: 'POST' });
        return response.json();
    }
};
