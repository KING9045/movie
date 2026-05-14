require('dotenv').config();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { initDB, query } = require('./database');

const endpoints = [
    { type: 'movie', url: 'https://vsembed.ru/movies/latest/page-', tmdb: '/movie/' },
    { type: 'tv', url: 'https://vsembed.ru/tvshows/latest/page-', tmdb: '/tv/' }
];
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
    let totalSynced = 0;

    for (const ep of endpoints) {
        console.log(`🚀 Starting Sync for ${ep.type.toUpperCase()} (Mode: ${isFullSync ? 'FULL' : limitPages + ' pages'})...`);

        const settingsKey = `last_synced_page_${ep.type}`;
        const settings = await query("SELECT value FROM settings WHERE key = ?", [settingsKey]);
        let page = (isFullSync && settings.length > 0) ? parseInt(settings[0].value) : 1;

        while (isFullSync || page <= limitPages) {
            try {
                console.log(`📦 Syncing ${ep.type.toUpperCase()} Page ${page}...`);
                const data = await robustFetch(`${ep.url}${page}.json`);
                const items = data.result;

                if (!items || items.length === 0) {
                    console.log(`🏁 No more ${ep.type}s found. Ending sync for this type.`);
                    break;
                }

                const batchSize = 10;
                for (let i = 0; i < items.length; i += batchSize) {
                    const batch = items.slice(i, i + batchSize);
                    
                    await Promise.all(batch.map(async (item) => {
                        const existing = await query("SELECT poster_path FROM movies WHERE tmdb_id = ? AND media_type = ?", [item.tmdb_id, ep.type]);
                        
                        let poster_path = existing.length > 0 ? existing[0].poster_path : null;
                        let overview = null, release_date = null, vote_average = null, genre_ids = '[]';

                        if (!poster_path && process.env.TMDB_API_KEY) {
                            try {
                                const tmdbData = await robustFetch(`${TMDB_API_BASE}${ep.tmdb}${item.tmdb_id}`, {
                                    Authorization: `Bearer ${process.env.TMDB_API_KEY}`
                                });
                                poster_path = tmdbData.poster_path;
                                overview = tmdbData.overview;
                                // TV shows use first_air_date instead of release_date
                                release_date = tmdbData.release_date || tmdbData.first_air_date;
                                vote_average = tmdbData.vote_average;
                                genre_ids = JSON.stringify(tmdbData.genres ? tmdbData.genres.map(g => g.id) : []);
                                console.log(`🖼️ Enriched ${ep.type}: ${item.title}`);
                            } catch (e) {
                                // Skip TMDB errors
                            }
                        }

                        await query(`
                            INSERT INTO movies (tmdb_id, imdb_id, title, quality, embed_url, poster_path, overview, release_date, vote_average, genre_ids, media_type)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(tmdb_id) DO UPDATE SET
                                quality = excluded.quality,
                                embed_url = excluded.embed_url,
                                poster_path = COALESCE(movies.poster_path, excluded.poster_path),
                                overview = COALESCE(movies.overview, excluded.overview),
                                release_date = COALESCE(movies.release_date, excluded.release_date),
                                vote_average = COALESCE(movies.vote_average, excluded.vote_average),
                                genre_ids = COALESCE(movies.genre_ids, excluded.genre_ids),
                                media_type = excluded.media_type
                        `, [
                            item.tmdb_id, item.imdb_id, item.title, item.quality, item.embed_url,
                            poster_path, overview, release_date, vote_average, genre_ids, ep.type
                        ]);
                    }));
                }
                
                console.log(`✅ ${ep.type.toUpperCase()} Page ${page} synced.`);
                totalSynced += items.length;
                page++;

                await query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [settingsKey, page]);

            } catch (error) {
                console.error(`❌ Error syncing ${ep.type} page ${page}:`, error.message);
                break;
            }
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
