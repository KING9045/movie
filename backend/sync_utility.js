require('dotenv').config();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { initDB, query } = require('./database');

const VIDSRC_BASE = 'https://vsembed.ru/movies/latest/page-';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';

async function robustFetch(url, headers = {}) {
    try {
        const headerStrings = Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
        const { stdout } = await execPromise(`curl -s ${headerStrings} "${url}"`);
        return JSON.parse(stdout);
    } catch (e) {
        console.warn(`❌ Robust fetch failed for ${url}: ${e.message}`);
        throw e;
    }
}

async function syncVidsrc(limitPages = 1, isFullSync = false) {
    await initDB();
    console.log(`🚀 Starting Vidsrc Sync (Mode: ${isFullSync ? 'FULL' : limitPages + ' pages'})...`);

    const settings = await query("SELECT value FROM settings WHERE key = 'last_synced_page'");
    let page = (isFullSync && settings.length > 0) ? parseInt(settings[0].value) : 1;
    let totalSynced = 0;

    while (isFullSync || page <= limitPages) {
        try {
            console.log(`📦 Syncing Page ${page}...`);
            const data = await robustFetch(`${VIDSRC_BASE}${page}.json`);
            const movies = data.result;

            if (!movies || movies.length === 0) {
                console.log('🏁 No more movies found. Ending sync.');
                break;
            }

            // Concurrency: Process movies in batches to speed up TMDB lookups
            const batchSize = 10;
            for (let i = 0; i < movies.length; i += batchSize) {
                const batch = movies.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (movie) => {
                    // Check if we already have this movie with a poster
                    const existing = await query("SELECT poster_path FROM movies WHERE tmdb_id = ?", [movie.tmdb_id]);
                    
                    let poster_path = existing.length > 0 ? existing[0].poster_path : null;
                    let overview = null, release_date = null, vote_average = null, genre_ids = '[]';

                    // Only lookup TMDB if we don't have a poster yet
                    if (!poster_path && process.env.TMDB_API_KEY) {
                        try {
                            const tmdbData = await robustFetch(`${TMDB_API_BASE}/movie/${movie.tmdb_id}`, {
                                Authorization: `Bearer ${process.env.TMDB_API_KEY}`
                            });
                            poster_path = tmdbData.poster_path;
                            overview = tmdbData.overview;
                            release_date = tmdbData.release_date;
                            vote_average = tmdbData.vote_average;
                            genre_ids = JSON.stringify(tmdbData.genres ? tmdbData.genres.map(g => g.id) : []);
                            console.log(`🖼️ Enriched: ${movie.title}`);
                        } catch (e) {
                            // Skip TMDB errors
                        }
                    }

                    await query(`
                        INSERT INTO movies (tmdb_id, imdb_id, title, quality, embed_url, poster_path, overview, release_date, vote_average, genre_ids)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(tmdb_id) DO UPDATE SET
                            quality = excluded.quality,
                            embed_url = excluded.embed_url,
                            poster_path = COALESCE(movies.poster_path, excluded.poster_path),
                            overview = COALESCE(movies.overview, excluded.overview),
                            release_date = COALESCE(movies.release_date, excluded.release_date),
                            vote_average = COALESCE(movies.vote_average, excluded.vote_average),
                            genre_ids = COALESCE(movies.genre_ids, excluded.genre_ids)
                    `, [
                        movie.tmdb_id, movie.imdb_id, movie.title, movie.quality, movie.embed_url,
                        poster_path, overview, release_date, vote_average, genre_ids
                    ]);
                }));
            }
            
            console.log(`✅ Page ${page} synced.`);
            totalSynced += movies.length;
            page++;

            // Optional: Store the last synced page in DB
            await query("INSERT INTO settings (key, value) VALUES ('last_synced_page', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [page]);

        } catch (error) {
            console.error(`❌ Error syncing page ${page}:`, error.message);
            break;
        }
    }

    console.log(`✨ Sync complete. Total synced: ${totalSynced}`);
    return { success: true, totalSynced };
}

if (require.main === module) {
    const pages = process.argv[2] === 'full' ? 0 : (parseInt(process.argv[2]) || 1);
    syncVidsrc(pages, process.argv[2] === 'full').catch(err => console.error(err));
}

module.exports = syncVidsrc;
