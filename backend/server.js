// node server.js
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { initDB, query } = require('./database');
const cron = require('node-cron');
const syncVidsrc = require('./sync_utility');

const app = express();
const PORT = process.env.PORT || 3000;

const path = require('path');

app.use(cors());
app.use(express.json());

// Serve static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
initDB().catch(err => console.error('Database Init Failed:', err));

// --- In-Memory TMDB Response Cache (TTL: 10 minutes) ---
const tmdbCache = new Map();
const TMDB_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
    const entry = tmdbCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > TMDB_CACHE_TTL_MS) {
        tmdbCache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache(key, data) {
    tmdbCache.set(key, { ts: Date.now(), data });
}

// --- Sync Status Tracker ---
let syncStatus = { running: false, lastRun: null, lastResult: null, totalSynced: 0 };

// --- Cron Scheduler ---
// Run every day at 00:00 (Midnight)
cron.schedule('0 0 * * *', async () => {
    console.log('⏰ [Scheduler] Starting Daily Sync (Latest 5 Pages)...');
    syncStatus = { running: true, lastRun: new Date().toISOString(), lastResult: null, totalSynced: 0 };
    try {
        const result = await syncVidsrc(5);
        syncStatus = { running: false, lastRun: syncStatus.lastRun, lastResult: 'success', totalSynced: result.totalSynced };
        console.log('⏰ [Scheduler] Daily Sync Finished.');
    } catch (e) {
        syncStatus = { running: false, lastRun: syncStatus.lastRun, lastResult: 'error', totalSynced: 0 };
        console.error('❌ [Scheduler] Sync Failed:', e.message);
    }
});

// --- API Routes ---

// 1. Get Synced Movies (from local SQLite)
app.get('/api/movies', async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const genre = req.query.genre;
    const media_type = req.query.media_type;
    
    try {
        let sql = `SELECT * FROM movies WHERE 1=1`;
        let params = [];
        
        if (genre) {
            sql += ` AND genre_ids LIKE ?`;
            params.push(`%${genre}%`);
        }

        if (media_type && media_type !== 'all') {
            sql += ` AND media_type = ?`;
            params.push(media_type);
        }
        
        sql += ` ORDER BY (poster_path IS NOT NULL) DESC, release_date DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const movies = await query(sql, params);
        res.json(movies);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Unified Search (Local + JIT External Sync)
app.get('/api/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.json([]);

    try {
        // Step 1: Search Local
        let results = await query(`
            SELECT * FROM movies 
            WHERE title LIKE ? 
            LIMIT 20
        `, [`%${q}%`]);

        // Step 2: If local results are sparse, trigger JIT Sync from TMDB
        if (results.length < 3) {
            console.log(`🔍 JIT Search & Sync for: "${q}"`);
            const searchData = await robustFetch(
                `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(q)}`,
                { Authorization: `Bearer ${process.env.TMDB_API_KEY}` }
            );

            if (searchData && searchData.results) {
                for (const item of searchData.results) {
                    if (item.media_type === 'movie' || item.media_type === 'tv') {
                        const title = item.title || item.name;
                        const releaseDate = item.release_date || item.first_air_date;
                        
                        await query(`
                            INSERT INTO movies (tmdb_id, title, poster_path, overview, release_date, vote_average, genre_ids, media_type)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
                                poster_path = COALESCE(excluded.poster_path, movies.poster_path),
                                overview = COALESCE(excluded.overview, movies.overview),
                                release_date = COALESCE(excluded.release_date, movies.release_date),
                                vote_average = COALESCE(excluded.vote_average, movies.vote_average),
                                genre_ids = COALESCE(excluded.genre_ids, movies.genre_ids)
                        `, [
                            item.id, title, item.poster_path, 
                            item.overview, releaseDate, item.vote_average,
                            JSON.stringify(item.genre_ids || []), item.media_type
                        ]);
                    }
                }
                
                // Re-query local to include new additions
                results = await query(`
                    SELECT * FROM movies 
                    WHERE title LIKE ? 
                    LIMIT 30
                `, [`%${q}%`]);
            }
        }

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Robust Fetch using axios (replaces unsafe curl shell exec) ---
async function robustFetch(url, headers = {}) {
    try {
        const response = await axios.get(url, {
            headers,
            timeout: 15000
        });
        return response.data;
    } catch (e) {
        console.error(`❌ Fetch failed for ${url}:`, e.message);
        throw e;
    }
}

// 3. TMDB Proxy (with in-memory cache)
app.use('/api/tmdb', async (req, res) => {
    const endpoint = req.url;
    const cacheKey = `tmdb:${endpoint}`;
    
    // Serve from cache if available
    const cached = getCached(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const data = await robustFetch(`https://api.themoviedb.org/3${endpoint}`, {
            Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
            accept: 'application/json'
        });
        setCache(cacheKey, data);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Vidsrc Proxy (for frontend sync)
app.get('/api/external/vidsrc/:page', async (req, res) => {
    const { page } = req.params;
    try {
        const data = await robustFetch(`https://vsembed.ru/movies/latest/page-${page}.json`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Trigger Backend Sync (Incremental)
app.post('/api/sync/more', async (req, res) => {
    if (syncStatus.running) {
        return res.json({ success: false, message: 'Sync already running.' });
    }
    try {
        syncStatus = { running: true, lastRun: new Date().toISOString(), lastResult: null, totalSynced: 0 };
        const result = await syncVidsrc(1);
        syncStatus = { running: false, lastRun: syncStatus.lastRun, lastResult: 'success', totalSynced: result.totalSynced };
        res.json({ success: true, ...result });
    } catch (error) {
        syncStatus = { running: false, lastRun: syncStatus.lastRun, lastResult: 'error', totalSynced: 0 };
        res.status(500).json({ error: error.message });
    }
});

// 6. Trigger Full Sync (All Pages)
app.post('/api/sync/full', async (req, res) => {
    if (syncStatus.running) {
        return res.json({ success: false, message: 'Sync already running.' });
    }
    console.log('🚀 Manual FULL Sync Requested...');
    syncStatus = { running: true, lastRun: new Date().toISOString(), lastResult: null, totalSynced: 0 };
    // Run in background since it takes time
    syncVidsrc(0, true).then(result => {
        console.log('✨ Manual Full Sync Finished:', result);
        syncStatus = { running: false, lastRun: syncStatus.lastRun, lastResult: 'success', totalSynced: result.totalSynced };
    }).catch(err => {
        console.error('❌ Manual Full Sync Failed:', err.message);
        syncStatus = { running: false, lastRun: syncStatus.lastRun, lastResult: 'error', totalSynced: 0 };
    });
    
    res.json({ success: true, message: 'Full sync started in background.' });
});

// 7. Sync Status Endpoint
app.get('/api/sync/status', (req, res) => {
    res.json(syncStatus);
});

// 8. Remote Telemetry / Live TV Log Ingestion
const fs = require('fs');
const logFilePath = path.join(__dirname, 'tv-remote.log');

app.post('/api/log', (req, res) => {
    const { type, message, tag, details, latency, timestamp } = req.body || {};
    const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    let prefix = '📺 [TV LOG]';
    if (type === 'error') prefix = '🔴 [TV ERROR]';
    else if (type === 'key') prefix = '🎮 [TV KEY]';
    else if (type === 'click') prefix = '🖱️ [TV CLICK]';
    else if (type === 'focus') prefix = '🎯 [TV FOCUS]';
    else if (type === 'perf') prefix = '⚡ [TV PERF]';

    const detailsStr = details ? (typeof details === 'object' ? JSON.stringify(details) : details) : '';
    const latencyStr = latency ? ` (${latency}ms)` : '';
    const logLine = `${time} ${prefix} [${tag || 'APP'}] ${message || ''}${latencyStr} ${detailsStr}`;

    console.log(logLine);

    // Append to tv-remote.log file for persistent inspection
    fs.appendFile(logFilePath, logLine + '\n', () => {});

    res.json({ ok: true });
});

// 8. User Activity (Watchlist/Favorites)
app.post('/api/user/activity', async (req, res) => {
    const { tmdb_id, media_type, status, is_favorite } = req.body;
    
    try {
        await query(`
            INSERT INTO user_activity (tmdb_id, media_type, status, is_favorite, last_interaction)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
                status = excluded.status,
                is_favorite = excluded.is_favorite,
                last_interaction = CURRENT_TIMESTAMP
        `, [tmdb_id, media_type || 'movie', status || 'unwatched', is_favorite ? 1 : 0]);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 9. Get User Watchlist / Favorites
app.get('/api/user/activity', async (req, res) => {
    const { is_favorite, status } = req.query;
    try {
        let sql = `
            SELECT m.*, ua.status, ua.is_favorite, ua.last_interaction
            FROM movies m
            JOIN user_activity ua ON m.tmdb_id = ua.tmdb_id AND m.media_type = ua.media_type
            WHERE 1=1
        `;
        const params = [];
        if (is_favorite === '1') { sql += ' AND ua.is_favorite = 1'; }
        if (status) { sql += ' AND ua.status = ?'; params.push(status); }
        sql += ' ORDER BY ua.last_interaction DESC';
        const results = await query(sql, params);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 10. Catch-all for SPA Routing
app.use((req, res, next) => {
    // Exclude API paths
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Cinemax Backend running on http://localhost:${PORT}`);
});
