// main.js — Cinemax Frontend Logic
// Uses LAN IP when running as native app, Vite proxy when in browser

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Auto-detect: native Capacitor app uses the server LAN IP, browser uses Vite proxy
const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
const API_BASE = isNative ? 'https://movies.caffegelatoarusha.shop' : '';
const PAGE_SIZE = 24;

// --- State ---
let currentOffset = 0;
let currentGenre  = '';
let currentQuery  = '';
let currentMediaType = 'all';
let movies        = [];
let heroMovie     = null;

// --- DOM References ---
const movieGrid         = document.getElementById('movie-grid');
const heroTitle         = document.getElementById('hero-title');
const heroOverview      = document.getElementById('hero-overview');
const heroBackdrop      = document.getElementById('hero-backdrop');
const heroPlay          = document.getElementById('hero-play');
const heroAddList       = document.getElementById('hero-addlist');
const searchInput       = document.getElementById('movie-search');
const loadMoreBtn       = document.getElementById('load-more-btn');
const loadMoreContainer = document.getElementById('load-more-container');
const syncLabel         = document.getElementById('sync-label');
const detailModal       = document.getElementById('detail-modal');
const playerModal       = document.getElementById('player-modal');
const closeDetail       = document.getElementById('close-detail');
const closePlayer       = document.getElementById('close-player');
const videoPlayer       = document.getElementById('video-player');
const detailPlay        = document.getElementById('detail-play');

// ============================================================
// DATA FETCHING — all from backend API
// ============================================================

async function fetchMovies(limit, offset, genre, mediaType) {
    const params = new URLSearchParams({ limit, offset, media_type: mediaType });
    if (genre) params.append('genre', genre);
    const res = await fetch(`${API_BASE}/api/movies?${params}`);
    if (!res.ok) throw new Error('Backend unreachable');
    return res.json();
}

async function fetchSearch(query) {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    return res.json();
}

async function fetchSeasons(tmdbId) {
    const res = await fetch(`${API_BASE}/api/tmdb/tv/${tmdbId}`);
    if (!res.ok) throw new Error('Failed to fetch seasons');
    return res.json();
}

async function fetchEpisodes(tmdbId, seasonNum) {
    const res = await fetch(`${API_BASE}/api/tmdb/tv/${tmdbId}/season/${seasonNum}`);
    if (!res.ok) throw new Error('Failed to fetch episodes');
    return res.json();
}

// ============================================================
// LOAD LIBRARY
// ============================================================

async function loadLibrary(query = '', append = false) {
    if (!append) {
        currentOffset = 0;
        currentQuery  = query;
        movies = [];
    }

    showSkeletons();

    try {
        let newMovies;
        if (query) {
            newMovies = await fetchSearch(query);
        } else {
            newMovies = await fetchMovies(PAGE_SIZE, currentOffset, currentGenre, currentMediaType);
        }

        movies = append ? [...movies, ...newMovies] : newMovies;

        // Show/hide Load More
        loadMoreContainer.style.display = (newMovies.length >= PAGE_SIZE && !query) ? 'flex' : 'none';

        renderMovies();

        // Set hero to first movie with a poster
        if (!append && movies.length > 0) {
            heroMovie = movies.find(m => m.poster_path) || movies[0];
            updateHero(heroMovie);
        }

    } catch (err) {
        console.error('Load error:', err);
        movieGrid.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">cloud_off</span>
                <p>Could not connect to backend.<br/>Make sure the server is running: <code>npm start</code> in the backend folder.</p>
            </div>`;
        loadMoreContainer.style.display = 'none';
    }
}

// ============================================================
// RENDERING
// ============================================================

function showSkeletons(count = 12) {
    movieGrid.innerHTML = Array(count).fill(0)
        .map(() => `<div class="movie-card skeleton-card skeleton"></div>`)
        .join('');
}

function posterUrl(path) {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}${path}`;
}

function renderMovies() {
    if (movies.length === 0) {
        movieGrid.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined">movie_filter</span>
                <p>No movies found. Try a different search or genre.</p>
            </div>`;
        return;
    }

    movieGrid.innerHTML = movies.map((movie, idx) => {
        const poster = posterUrl(movie.poster_path)
            || `https://placehold.co/200x300/1f1f24/c9beff?text=${encodeURIComponent((movie.title || '?').charAt(0))}`;
        const year   = movie.release_date ? movie.release_date.split('-')[0] : '';
        const rating = movie.vote_average ? parseFloat(movie.vote_average).toFixed(1) : '';

        const typeTag = movie.media_type === 'tv' ? `<span class="tag tag-primary" style="margin-left:auto; font-size:9px; padding: 2px 6px;">TV</span>` : '';

        return `
        <div class="movie-card" data-idx="${idx}" tabindex="0" role="button" aria-label="Watch ${escHtml(movie.title)}">
            <img class="movie-card-poster" src="${poster}" alt="${escHtml(movie.title)}" loading="lazy"
                onerror="this.src='https://placehold.co/200x300/1f1f24/c9beff?text=${encodeURIComponent((movie.title || '?').charAt(0))}'" />
            <div class="movie-card-gradient-bar"></div>
            <div class="movie-card-info">
                <div class="movie-card-title">${escHtml(movie.title)}</div>
                <div class="movie-card-meta">
                    ${rating ? `<span class="material-symbols-outlined">star</span><span>${rating}</span>` : ''}
                    ${year ? `<span>•</span><span>${year}</span>` : ''}
                    ${typeTag}
                </div>
            </div>
        </div>`;
    }).join('');

    // Attach events
    document.querySelectorAll('.movie-card[data-idx]').forEach(card => {
        const onClick = () => openDetail(movies[parseInt(card.dataset.idx)]);
        card.addEventListener('click', onClick);
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
        });
    });
}

function updateHero(movie) {
    if (!movie) return;
    heroTitle.textContent   = movie.title || 'Cinemax';
    heroOverview.textContent = movie.overview || 'Stream thousands of movies from around the world.';

    const bg = posterUrl(movie.poster_path);
    if (bg) {
        const img = document.createElement('img');
        img.src = bg;
        img.alt = movie.title;
        heroBackdrop.innerHTML = '';
        heroBackdrop.appendChild(img);
        const vignette = document.createElement('div');
        vignette.className = 'hero-vignette';
        heroBackdrop.appendChild(vignette);
    }

    heroPlay.onclick = () => openDetail(movie);
}

// ============================================================
// DETAIL MODAL
// ============================================================

function openDetail(movie) {
    const poster = posterUrl(movie.poster_path) || '';
    const year   = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
    const rating = movie.vote_average ? parseFloat(movie.vote_average).toFixed(1) : '';

    // Backdrop
    const backdrop = document.getElementById('detail-backdrop');
    backdrop.innerHTML = poster
        ? `<img src="${poster}" alt="${escHtml(movie.title)}" />`
        : '';

    // Tags
    document.getElementById('detail-tags').innerHTML = `
        <span class="tag tag-primary">${movie.media_type === 'tv' ? 'TV SERIES' : 'MOVIE'}</span>
        ${movie.quality ? `<span class="tag tag-quality">${escHtml(movie.quality)}</span>` : ''}
        ${rating ? `<span class="tag tag-quality">⭐ ${rating}</span>` : ''}
    `;

    document.getElementById('detail-title').textContent = movie.title || '';
    document.getElementById('detail-meta').innerHTML = `
        <span>${year}</span>
        ${movie.quality ? `<span class="detail-meta-divider">|</span><span>${escHtml(movie.quality)}</span>` : ''}
    `;
    document.getElementById('detail-overview').textContent =
        movie.overview || 'No description available.';

    const detailPlayBtn = document.getElementById('detail-play');
    const tvContainer = document.getElementById('tv-details-container');
    
    if (movie.media_type === 'tv') {
        detailPlayBtn.style.display = 'none';
        tvContainer.style.display = 'block';
        document.getElementById('season-selector').innerHTML = 'Loading seasons...';
        document.getElementById('episode-list').innerHTML = '';
        renderTVDetails(movie);
    } else {
        detailPlayBtn.style.display = 'inline-flex';
        tvContainer.style.display = 'none';
        detailPlayBtn.onclick = () => openPlayer(movie);
    }

    detailModal.classList.add('active');
    detailModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

async function renderTVDetails(movie) {
    try {
        const tvData = await fetchSeasons(movie.tmdb_id);
        const seasons = tvData.seasons.filter(s => s.season_number > 0);
        
        const seasonSelector = document.getElementById('season-selector');
        seasonSelector.innerHTML = seasons.map((s, idx) => `
            <button class="season-btn ${idx === 0 ? 'active' : ''}" data-season="${s.season_number}">
                Season ${s.season_number}
            </button>
        `).join('');

        seasonSelector.querySelectorAll('.season-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                seasonSelector.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                await renderEpisodes(movie, btn.dataset.season);
            });
        });

        if (seasons.length > 0) {
            await renderEpisodes(movie, seasons[0].season_number);
        }
    } catch (e) {
        document.getElementById('season-selector').innerHTML = 'Failed to load TV details.';
    }
}

async function renderEpisodes(movie, seasonNum) {
    const episodeList = document.getElementById('episode-list');
    episodeList.innerHTML = '<div class="skeleton" style="width:260px; height:180px;"></div>'.repeat(3);
    
    try {
        const seasonData = await fetchEpisodes(movie.tmdb_id, seasonNum);
        
        episodeList.innerHTML = seasonData.episodes.map(ep => {
            const thumb = posterUrl(ep.still_path) || posterUrl(movie.poster_path);
            return `
            <div class="episode-card" data-season="${seasonNum}" data-episode="${ep.episode_number}">
                <img src="${thumb}" alt="${escHtml(ep.name)}" loading="lazy">
                <div class="episode-info">
                    <div class="episode-title">${ep.episode_number}. ${escHtml(ep.name)}</div>
                    <div class="episode-overview">${escHtml(ep.overview) || 'No overview available.'}</div>
                </div>
            </div>`;
        }).join('');

        episodeList.querySelectorAll('.episode-card').forEach(card => {
            card.addEventListener('click', () => {
                openPlayer(movie, card.dataset.season, card.dataset.episode);
            });
        });
    } catch (e) {
        episodeList.innerHTML = 'Failed to load episodes.';
    }
}

function closeDetailModal() {
    detailModal.classList.remove('active');
    detailModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// ============================================================
// PLAYER MODAL
// ============================================================

function openPlayer(movie, seasonNum = 1, episodeNum = 1) {
    const src = movie.media_type === 'tv' 
        ? `https://vidsrc.to/embed/tv/${movie.tmdb_id}/${seasonNum}/${episodeNum}`
        : `https://vidsrc.to/embed/movie/${movie.tmdb_id}`;
    videoPlayer.src = src;
    playerModal.classList.add('active');
    playerModal.setAttribute('aria-hidden', 'false');
    detailModal.classList.remove('active');
    document.body.style.overflow = 'hidden';
}

function closePlayerModal() {
    playerModal.classList.remove('active');
    playerModal.setAttribute('aria-hidden', 'true');
    videoPlayer.src = '';
    document.body.style.overflow = '';
}

// ============================================================
// EVENTS
// ============================================================

// Modals
closeDetail.addEventListener('click', closeDetailModal);
closePlayer.addEventListener('click', closePlayerModal);
detailModal.addEventListener('click', e => { if (e.target === detailModal) closeDetailModal(); });
playerModal.addEventListener('click', e => { if (e.target === playerModal) closePlayerModal(); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (playerModal.classList.contains('active')) closePlayerModal();
        else if (detailModal.classList.contains('active')) closeDetailModal();
    }
});

// Search
let searchTimeout;
searchInput.addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadLibrary(e.target.value.trim()), 400);
});

// Genre Filter
document.querySelectorAll('.genre-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentGenre = btn.dataset.id;
        loadLibrary();
    });
});

// Load More
loadMoreBtn.addEventListener('click', async () => {
    currentOffset += PAGE_SIZE;
    await loadLibrary(currentQuery, true);
});

// Sidebar nav
document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        const section = item.dataset.section;
        if (section === 'search') {
            searchInput.focus();
        } else if (section === 'movies') {
            currentMediaType = 'movie';
            loadLibrary();
        } else if (section === 'tv') {
            currentMediaType = 'tv';
            loadLibrary();
        } else if (section === 'home') {
            currentMediaType = 'all';
            loadLibrary();
        }
    });
});

// Sync trigger (sidebar button)
window.triggerSync = async function(e) {
    e.preventDefault();
    syncLabel.textContent = 'Syncing...';
    try {
        await fetch(`${API_BASE}/api/sync/full`, { method: 'POST' });
        syncLabel.textContent = 'Sync Library';
        loadLibrary();
    } catch {
        syncLabel.textContent = 'Sync Library';
    }
};

// ============================================================
// UTILITY
// ============================================================

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// INIT
// ============================================================

loadLibrary();
