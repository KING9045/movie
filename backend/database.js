const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'movies.sqlite');
const db = new sqlite3.Database(dbPath);

function initDB() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Movies table synced from external sources
            db.run(`
                CREATE TABLE IF NOT EXISTS movies (
                    tmdb_id INTEGER PRIMARY KEY,
                    imdb_id TEXT,
                    title TEXT NOT NULL,
                    quality TEXT,
                    embed_url TEXT,
                    time_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    poster_path TEXT,
                    overview TEXT,
                    release_date TEXT,
                    vote_average REAL,
                    genre_ids TEXT
                )
            `);

            // User data table for favorites and watch status
            db.run(`
                CREATE TABLE IF NOT EXISTS user_activity (
                    tmdb_id INTEGER PRIMARY KEY,
                    status TEXT CHECK( status IN ('watched', 'unwatched', 'watchlist') ) DEFAULT 'unwatched',
                    is_favorite BOOLEAN DEFAULT 0,
                    last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (tmdb_id) REFERENCES movies (tmdb_id)
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
