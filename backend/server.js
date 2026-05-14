// node server.js
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const { initDB, query } = require('./database');
const axios = require('axios');
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

// --- Cron Scheduler ---
// Run every day at 00:00 (Midnight)
cron.schedule('0 0 * * *', async () => {
    console.log('⏰ [Scheduler] Starting Daily Sync (Latest 5 Pages)...');
    try {
        await syncVidsrc(5); 
        console.log('⏰ [Scheduler] Daily Sync Finished.');
    } catch (e) {
        console.error('❌ [Scheduler] Sync Failed:', e.message);
    }
});

// --- API Routes ---

// 1. Get Synced Movies (from local SQLite)
app.get('/api/movies', async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const genre = req.query.genre;
    
    try {
        let sql = `SELECT * FROM movies`;
        let params = [];
        
        if (genre) {
            sql += ` WHERE genre_ids LIKE ?`;
            params.push(`%${genre}%`);
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
            const searchData = await robustFetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}`, {
                Authorization: `Bearer ${process.env.TMDB_API_KEY}`
            });

            if (searchData.results) {
                for (const movie of searchData.results) {
                    await query(`
                        INSERT INTO movies (tmdb_id, title, poster_path, overview, release_date, vote_average, genre_ids)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(tmdb_id) DO UPDATE SET
                            poster_path = COALESCE(excluded.poster_path, movies.poster_path),
                            overview = COALESCE(excluded.overview, movies.overview),
                            release_date = COALESCE(excluded.release_date, movies.release_date),
                            vote_average = COALESCE(excluded.vote_average, movies.vote_average),
                            genre_ids = COALESCE(excluded.genre_ids, movies.genre_ids)
                    `, [
                        movie.id, movie.title, movie.poster_path, 
                        movie.overview, movie.release_date, movie.vote_average,
                        JSON.stringify(movie.genre_ids || [])
                    ]);
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

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function robustFetch(url, headers = {}) {
    try {
        const headerStrings = Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
        const { stdout } = await execPromise(`curl -s ${headerStrings} "${url}"`);
        return JSON.parse(stdout);
    } catch (e) {
        console.error(`❌ Robust fetch failed for ${url}:`, e.message);
        throw e;
    }
}

// 2. TMDB Proxy
app.use('/api/tmdb', async (req, res) => {
    const endpoint = req.url;
    
    try {
        const data = await robustFetch(`https://api.themoviedb.org/3${endpoint}`, {
            Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
            accept: 'application/json'
        });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Vidsrc Proxy (for frontend sync)
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
    try {
        const result = await syncVidsrc(1);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Trigger Full Sync (All Pages)
app.post('/api/sync/full', async (req, res) => {
    console.log('🚀 Manual FULL Sync Requested...');
    // We run this in the background since it takes time
    syncVidsrc(0, true).then(result => {
        console.log('✨ Manual Full Sync Finished:', result);
    }).catch(err => {
        console.error('❌ Manual Full Sync Failed:', err.message);
    });
    
    res.json({ success: true, message: 'Full sync started in background.' });
});

// 7. User Activity (Watchlist/Favorites)
app.post('/api/user/activity', async (req, res) => {
    const { tmdb_id, status, is_favorite } = req.body;
    
    try {
        await query(`
            INSERT INTO user_activity (tmdb_id, status, is_favorite, last_interaction)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tmdb_id) DO UPDATE SET
                status = excluded.status,
                is_favorite = excluded.is_favorite,
                last_interaction = CURRENT_TIMESTAMP
        `, [tmdb_id, status || 'unwatched', is_favorite ? 1 : 0]);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. Catch-all for SPA Routing
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
