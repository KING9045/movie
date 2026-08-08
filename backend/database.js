const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// In Docker, DB_PATH points to a mounted volume (/data/movies.sqlite)
// Locally it falls back to the backend directory
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'movies.sqlite');
const db = new sqlite3.Database(dbPath);

function initDB() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Enable WAL mode for better concurrent read performance
            db.run(`PRAGMA journal_mode=WAL`);

            // Movies table synced from external sources
            // PRIMARY KEY is (tmdb_id, media_type) to avoid collision between
            // movies and TV shows that share the same TMDB numeric ID.
            db.run(`
                CREATE TABLE IF NOT EXISTS movies (
                    tmdb_id INTEGER NOT NULL,
                    media_type TEXT NOT NULL DEFAULT 'movie',
                    imdb_id TEXT,
                    title TEXT NOT NULL,
                    quality TEXT,
                    embed_url TEXT,
                    time_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    poster_path TEXT,
                    overview TEXT,
                    release_date TEXT,
                    vote_average REAL,
                    genre_ids TEXT,
                    PRIMARY KEY (tmdb_id, media_type)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating movies table:', err.message);
                }
            });

            // Safe migration: if old table exists with single PK, the CREATE IF NOT EXISTS
            // will be a no-op but we handle it gracefully.
            // New columns for existing DBs:
            db.run("ALTER TABLE movies ADD COLUMN quality TEXT", () => {});
            db.run("ALTER TABLE movies ADD COLUMN embed_url TEXT", () => {});
            db.run("ALTER TABLE movies ADD COLUMN imdb_id TEXT", () => {});

            // User data table for favorites and watch status
            // Also uses composite PK (tmdb_id, media_type) to mirror movies table
            db.run(`
                CREATE TABLE IF NOT EXISTS user_activity (
                    tmdb_id INTEGER NOT NULL,
                    media_type TEXT NOT NULL DEFAULT 'movie',
                    status TEXT CHECK( status IN ('watched', 'unwatched', 'watchlist') ) DEFAULT 'unwatched',
                    is_favorite BOOLEAN DEFAULT 0,
                    last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (tmdb_id, media_type)
                )
            `);

            // Settings table for tracking sync progress etc.
            db.run(`
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error initializing database:', err.message);
                    reject(err);
                } else {
                    console.log('✅ SQLite Database initialized at:', dbPath);
                    resolve();
                }
            });
        });
    });
}

// Utility to run queries with promises
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        } else {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        }
    });
};

module.exports = {
    db,
    initDB,
    query
};
