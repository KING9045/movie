import Dexie from 'dexie';

export const db = new Dexie('CinemaxDB');

// Define database schema
db.version(2).stores({
    movies: '++id, tmdb_id, imdb_id, title, [tmdb_id+title], time_added, release_date, poster_path',
    activity: 'tmdb_id, status, is_favorite'
});

export const DB = {
    async saveMovies(movieList) {
        return db.movies.bulkPut(movieList);
    },

    async getAllMovies(limit = 20, offset = 0, genreId = '') {
        let collection = db.movies.orderBy('release_date').reverse();
        
        if (genreId) {
            // Simple filter for genre string (assuming genre_ids is a JSON string of IDs)
            collection = collection.filter(movie => {
                try {
                    const genres = JSON.parse(movie.genre_ids || '[]');
                    return genres.includes(parseInt(genreId));
                } catch(e) { return false; }
            });
        }

        return collection
            .offset(offset)
            .limit(limit)
            .toArray();
    },

    async searchMovies(query) {
        if (!query) return this.getAllMovies();
        return db.movies
            .where('title')
            .startsWithIgnoreCase(query)
            .limit(50)
            .toArray();
    },

    async getCount() {
        return db.movies.count();
    }
};
