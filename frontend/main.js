// main.js — Cinemax Frontend Logic
// Uses smartFetch (CapacitorHttp on native, regular fetch on web) for CORS safety

import { initTVNavigation } from './src/tv-navigation.js';
import { logger } from './src/remote-logger.js';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Auto-detect: native Capacitor app uses the server LAN IP, browser uses Vite proxy
const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
const API_BASE = isNative ? 'https://movies.caffegelato-arusha.com' : '';
const PAGE_SIZE = 24;

// --- State ---
let currentOffset = 0;
let currentGenre  = '';
let currentQuery  = '';
let currentMediaType = 'all';
let movies        = [];
let heroMovie     = null;
let currentMovie  = null;
let currentSeason = 1;
let currentEpisode = 1;
let countdownInterval = null;
let controlsTimeout = null;
let activeServer  = 'vidsrc_me';

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
// Fix: correct button ID is 'player-control-back', not 'close-player'
const closePlayer       = document.getElementById('player-control-back');
const videoPlayer       = document.getElementById('video-player');
const detailPlay        = document.getElementById('detail-play');

// ============================================================
// SMART FETCH — CapacitorHttp on native (bypasses CORS), fetch on web
// ============================================================

async function smartFetch(url, options = {}) {
    if (isNative && window.Capacitor && window.Capacitor.Http) {
        // Use Native HTTP to bypass CORS on Android/TV WebView
        const response = await window.Capacitor.Http.request({
            url,
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
        if (!response.ok) throw new Error(`API Error: ${response.status} for ${url}`);
        return response.json();
    }
}

// ============================================================
// DATA FETCHING — all from backend API
// ============================================================

async function fetchMovies(limit, offset, genre, mediaType) {
    const params = new URLSearchParams({ limit, offset, media_type: mediaType });
    if (genre) params.append('genre', genre);
    return smartFetch(`${API_BASE}/api/movies?${params}`);
}

async function fetchSearch(query) {
    return smartFetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
}

async function fetchSeasons(tmdbId) {
    return smartFetch(`${API_BASE}/api/tmdb/tv/${tmdbId}`);
}

async function fetchEpisodes(tmdbId, seasonNum) {
    return smartFetch(`${API_BASE}/api/tmdb/tv/${tmdbId}/season/${seasonNum}`);
}

async function fetchUserActivity() {
    return smartFetch(`${API_BASE}/api/user/activity`);
}

async function saveUserActivity(tmdbId, mediaType, status, isFavorite) {
    return smartFetch(`${API_BASE}/api/user/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdb_id: tmdbId, media_type: mediaType, status, is_favorite: isFavorite })
    });
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
// MY LIST — in-memory set, persisted to backend
// ============================================================

const myList = new Set(); // stores strings like "550:movie"

function myListKey(movie) {
    return `${movie.tmdb_id}:${movie.media_type || 'movie'}`;
}

async function toggleMyList(movie, btnEl) {
    const key = myListKey(movie);
    const isFav = myList.has(key);
    const newFav = !isFav;

    if (newFav) myList.add(key); else myList.delete(key);
    updateMyListButtons(movie, newFav);

    try {
        await saveUserActivity(movie.tmdb_id, movie.media_type || 'movie', 'watchlist', newFav);
    } catch (e) {
        // Revert on failure
        if (newFav) myList.delete(key); else myList.add(key);
        updateMyListButtons(movie, !newFav);
        console.error('Failed to save to My List:', e);
    }
}

function updateMyListButtons(movie, isFav) {
    const key = myListKey(movie);
    document.querySelectorAll(`.mylist-btn[data-key="${key}"]`).forEach(btn => {
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = isFav ? 'bookmark_added' : 'add';
        btn.setAttribute('aria-label', isFav ? 'Remove from My List' : 'Add to My List');
    });
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

    // Hero My List button
    heroAddList.dataset.key = myListKey(movie);
    heroAddList.classList.add('mylist-btn');
    heroAddList.setAttribute('data-key', myListKey(movie));
    const heroAddIcon = heroAddList.querySelector('.material-symbols-outlined');
    if (heroAddIcon) heroAddIcon.textContent = myList.has(myListKey(movie)) ? 'bookmark_added' : 'add';
    heroAddList.onclick = () => toggleMyList(movie, heroAddList);
}

// ============================================================
// DETAIL MODAL
// ============================================================

function openDetail(movie) {
    currentMovie = movie;
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

    // Wire My List button in detail modal
    const detailMyListBtn = document.getElementById('detail-mylist-btn');
    if (detailMyListBtn) {
        const key = myListKey(movie);
        detailMyListBtn.dataset.key = key;
        detailMyListBtn.setAttribute('data-key', key);
        detailMyListBtn.classList.add('mylist-btn');
        const icon = detailMyListBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = myList.has(key) ? 'bookmark_added' : 'add';
        detailMyListBtn.onclick = () => toggleMyList(movie, detailMyListBtn);
    }

    detailModal.classList.add('active');
    detailModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (window.AndroidBridge) {
        window.AndroidBridge.setModalActive(true);
    }
}

async function renderTVDetails(movie) {
    try {
        const tvData = await fetchSeasons(movie.tmdb_id);
        const seasons = tvData.seasons.filter(s => s.season_number > 0);
        
        const seasonSelector = document.getElementById('season-selector');
        seasonSelector.innerHTML = seasons.map((s, idx) => `
            <button class="season-btn ${idx === 0 ? 'active' : ''}" data-season="${s.season_number}" tabindex="0">
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
            <div class="episode-card" data-season="${seasonNum}" data-episode="${ep.episode_number}" tabindex="0">
                <img src="${thumb}" alt="${escHtml(ep.name)}" loading="lazy">
                <div class="episode-info">
                    <div class="episode-title">${ep.episode_number}. ${escHtml(ep.name)}</div>
                    <div class="episode-overview">${escHtml(ep.overview) || 'No overview available.'}</div>
                </div>
            </div>`;
        }).join('');

        episodeList.querySelectorAll('.episode-card').forEach(card => {
            const openEp = () => openPlayer(movie, card.dataset.season, card.dataset.episode);
            card.addEventListener('click', openEp);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEp(); }
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
    if (window.AndroidBridge) {
        window.AndroidBridge.setModalActive(false);
    }
}

// ============================================================
// PLAYER MODAL
// ============================================================

function openPlayer(movie, seasonNum = 1, episodeNum = 1) {
    currentMovie = movie;
    currentSeason = seasonNum;
    currentEpisode = episodeNum;
    
    const selectEl = document.getElementById('server-select');
    if (selectEl) {
        activeServer = selectEl.value;
    }
    
    playerModal.classList.add('active');
    playerModal.setAttribute('aria-hidden', 'false');
    detailModal.classList.remove('active');
    document.body.style.overflow = 'hidden';
    
    if (window.AndroidBridge) {
        window.AndroidBridge.setModalActive(true);
    }
    
    startPlayerWithBypass();
}

function startPlayerWithBypass() {
    const bypassScreen = document.getElementById('player-ad-bypass');
    const tapToPlay = document.getElementById('player-tap-to-play');
    const controlsOverlay = document.getElementById('player-controls-overlay');
    const countdownVal = document.getElementById('bypass-countdown');
    const playerTitle = document.getElementById('player-control-title');
    
    if (playerTitle && currentMovie) {
        playerTitle.textContent = currentMovie.title + (currentMovie.media_type === 'tv' ? ` - Season ${currentSeason}, Ep ${currentEpisode}` : '');
    }
    
    const pills = document.querySelectorAll('.server-pill-btn');
    pills.forEach(pill => {
        if (pill.dataset.server === activeServer) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });
    
    // Hide all overlays, show bypass loader first
    if (controlsOverlay) controlsOverlay.classList.remove('visible');
    if (tapToPlay) tapToPlay.classList.remove('active');
    if (bypassScreen) bypassScreen.classList.add('active');
    
    let timeLeft = 5;
    if (countdownVal) countdownVal.textContent = timeLeft;
    
    let src = '';
    if (currentMovie.media_type === 'tv') {
        if (activeServer === 'vidsrc_me') {
            const id = currentMovie.imdb_id || currentMovie.tmdb_id;
            src = `https://vidsrc.me/embed/${id}/${currentSeason}-${currentEpisode}/`;
        } else if (activeServer === 'vidsrc_xyz') {
            src = `https://vidsrc.xyz/embed/tv?tmdb=${currentMovie.tmdb_id}&season=${currentSeason}&episode=${currentEpisode}`;
        } else if (activeServer === 'autoembed') {
            src = `https://autoembed.co/tv/tmdb/${currentMovie.tmdb_id}-${currentSeason}-${currentEpisode}`;
        } else if (activeServer === 'multiembed') {
            src = `https://multiembed.mov/directstream.php?video_id=${currentMovie.tmdb_id}&tmdb=1&s=${currentSeason}&e=${currentEpisode}`;
        } else {
            src = `https://vidsrc.to/embed/tv/${currentMovie.tmdb_id}/${currentSeason}/${currentEpisode}`;
        }
    } else {
        if (activeServer === 'vidsrc_me') {
            const id = currentMovie.imdb_id || currentMovie.tmdb_id;
            src = `https://vidsrc.me/embed/${id}/`;
        } else if (activeServer === 'vidsrc_xyz') {
            src = `https://vidsrc.xyz/embed/movie?tmdb=${currentMovie.tmdb_id}`;
        } else if (activeServer === 'autoembed') {
            src = `https://autoembed.co/movie/tmdb/${currentMovie.tmdb_id}`;
        } else if (activeServer === 'multiembed') {
            src = `https://multiembed.mov/directstream.php?video_id=${currentMovie.tmdb_id}&tmdb=1`;
        } else {
            src = `https://vidsrc.to/embed/movie/${currentMovie.tmdb_id}`;
        }
    }
    
    videoPlayer.src = 'about:blank';
    videoPlayer.src = src;
    
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        timeLeft--;
        if (countdownVal) countdownVal.textContent = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            // Bypass countdown done — show "Tap to Play" screen
            if (bypassScreen) bypassScreen.classList.remove('active');
            showTapToPlay();
        }
    }, 1000);
}

// ============================================================
// TAP TO PLAY — fires synthetic events into the iframe
// ============================================================

function showTapToPlay() {
    const tapToPlay = document.getElementById('player-tap-to-play');
    if (tapToPlay) {
        tapToPlay.classList.add('active');
        // Auto-focus the play button so D-Pad Enter works immediately
        setTimeout(() => {
            const btn = document.getElementById('tap-to-play-btn');
            if (btn) btn.focus();
        }, 100);
    }
}

function hideTapToPlay() {
    const tapToPlay = document.getElementById('player-tap-to-play');
    if (tapToPlay) tapToPlay.classList.remove('active');
}

/**
 * Simulate a click/tap at the center of the iframe.
 * Uses multiple strategies for Android TV WebView compatibility:
 *  1. PointerEvent (touch type) — works on modern WebViews
 *  2. MouseEvent click — works on some older WebViews
 *  3. TouchEvent — Android-specific fallback
 *  4. iframe.focus() + Enter key — passes control to iframe
 */
function simulateIframeClick() {
    const iframe = document.getElementById('video-player');
    if (!iframe) return;

    // Primary Android Native Strategy: Send genuine MotionEvent touch taps at screen center
    if (window.AndroidBridge && typeof window.AndroidBridge.simulateNativeClick === 'function') {
        console.log('📺 [Player] Performing Native Android 2-Tap Sequence...');
        
        // Tap 1: Bypasses preliminary splash / ad overlay in iframe
        window.AndroidBridge.simulateNativeClick();

        // Tap 2 (800ms later): Hits the central video play button that appears after ad dismissal
        setTimeout(() => {
            if (window.AndroidBridge) {
                window.AndroidBridge.simulateNativeClick();
            }
        }, 800);
        return;
    }

    // Web Browser Fallbacks
    const rect = iframe.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const shared = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY,
        screenX: centerX,
        screenY: centerY,
    };

    try {
        iframe.dispatchEvent(new MouseEvent('mousedown', shared));
        iframe.dispatchEvent(new MouseEvent('mouseup',   shared));
        iframe.dispatchEvent(new MouseEvent('click',     shared));
    } catch(e) { console.warn('MouseEvent strategy failed:', e.message); }

    try {
        iframe.focus();
        iframe.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
    } catch(e) { console.warn('Keyboard strategy failed:', e.message); }
}

function showPlayerControls() {
    const controls = document.getElementById('player-controls-overlay');
    const bypassScreen = document.getElementById('player-ad-bypass');
    const tapToPlay = document.getElementById('player-tap-to-play');
    
    // Don't show controls while bypass loader or tap-to-play is active
    if (bypassScreen && bypassScreen.classList.contains('active')) return;
    if (tapToPlay && tapToPlay.classList.contains('active')) return;
    if (!controls) return;
    
    controls.classList.add('visible');
    
    // Focus back button so D-Pad can navigate away
    const backBtn = document.getElementById('player-control-back');
    if (backBtn) {
        backBtn.focus();
    }
    
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
        controls.classList.remove('visible');
    }, 6000);
}

function closePlayerModal() {
    clearInterval(countdownInterval);
    clearTimeout(controlsTimeout);
    
    const bypassScreen = document.getElementById('player-ad-bypass');
    const tapToPlay = document.getElementById('player-tap-to-play');
    const controlsOverlay = document.getElementById('player-controls-overlay');
    if (bypassScreen) bypassScreen.classList.remove('active');
    if (tapToPlay) tapToPlay.classList.remove('active');
    if (controlsOverlay) controlsOverlay.classList.remove('visible');
    
    playerModal.classList.remove('active');
    playerModal.setAttribute('aria-hidden', 'true');
    videoPlayer.src = 'about:blank';
    document.body.style.overflow = '';
    
    if (window.AndroidBridge) {
        window.AndroidBridge.setModalActive(false);
    }
    
    const detailPlayBtn = document.getElementById('detail-play');
    if (detailPlayBtn && detailPlayBtn.style.display !== 'none') {
        detailPlayBtn.focus();
    } else {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) {
            const firstButton = activeModal.querySelector('button, [tabindex="0"]');
            if (firstButton) firstButton.focus();
        }
    }
}

// ============================================================
// MY LIST PAGE — render watchlist items
// ============================================================

async function loadMyListPage() {
    movieGrid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">bookmark</span><p>Loading your list...</p></div>';
    loadMoreContainer.style.display = 'none';

    try {
        const items = await fetchUserActivity();
        if (items.length === 0) {
            movieGrid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">bookmark_border</span><p>Your list is empty. Add movies by pressing the bookmark button.</p></div>';
            return;
        }
        movies = items;
        items.forEach(m => myList.add(myListKey(m)));
        renderMovies();
    } catch (e) {
        movieGrid.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">cloud_off</span><p>Failed to load your list.</p></div>';
    }
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
    // Show player controls on any keypress while player is open (D-Pad support)
    if (playerModal.classList.contains('active')) {
        showPlayerControls();
    }
    if (e.key === 'Escape') {
        if (playerModal.classList.contains('active')) closePlayerModal();
        else if (detailModal.classList.contains('active')) closeDetailModal();
    }
});

// Show controls on player click/touch
playerModal.addEventListener('click', () => {
    if (playerModal.classList.contains('active')) {
        showPlayerControls();
    }
});
// mousemove only relevant on desktop/cursor — kept for web usage
playerModal.addEventListener('mousemove', () => {
    if (playerModal.classList.contains('active')) {
        showPlayerControls();
    }
});

// Tap to Play button — fires synthetic events into cross-origin iframe
const tapToPlayBtn = document.getElementById('tap-to-play-btn');
if (tapToPlayBtn) {
    const onTapToPlay = () => {
        // Fire all strategies to click the in-iframe play button
        simulateIframeClick();
        // Hide our overlay so the iframe is fully visible
        hideTapToPlay();
        // Briefly show our controls so user knows how to go back
        showPlayerControls();
    };
    tapToPlayBtn.addEventListener('click', onTapToPlay);
    tapToPlayBtn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTapToPlay();
        }
    });
}

// Server pills in player overlay
document.querySelectorAll('.server-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        activeServer = btn.dataset.server;
        const selectEl = document.getElementById('server-select');
        if (selectEl) selectEl.value = activeServer;
        startPlayerWithBypass();
    });
});

// Refresh button in player overlay
const refreshBtn = document.getElementById('player-control-refresh');
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        startPlayerWithBypass();
    });
}

// Media Play/Pause toggle button in overlay
const togglePlayBtn = document.getElementById('player-control-toggle-play');
if (togglePlayBtn) {
    togglePlayBtn.addEventListener('click', () => {
        simulateIframeClick();
    });
}

// Rewind 10s button
const rewindBtn = document.getElementById('player-control-rewind');
if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
        const iframe = document.getElementById('video-player');
        if (iframe) {
            iframe.focus();
            iframe.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true }));
        }
        if (window.AndroidBridge && typeof window.AndroidBridge.simulateNativeClick === 'function') {
            window.AndroidBridge.simulateNativeClick();
        }
    });
}

// Forward 10s button
const forwardBtn = document.getElementById('player-control-forward');
if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
        const iframe = document.getElementById('video-player');
        if (iframe) {
            iframe.focus();
            iframe.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
        }
        if (window.AndroidBridge && typeof window.AndroidBridge.simulateNativeClick === 'function') {
            window.AndroidBridge.simulateNativeClick();
        }
    });
}

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

// Sidebar nav — FIX: clear search input when switching sections
document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        const section = item.dataset.section;
        if (section === 'search') {
            searchInput.focus();
        } else if (section === 'movies') {
            searchInput.value = ''; // clear search when switching sections
            currentGenre = '';
            currentMediaType = 'movie';
            document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.genre-btn[data-id=""]').classList.add('active');
            loadLibrary();
        } else if (section === 'tv') {
            searchInput.value = '';
            currentGenre = '';
            currentMediaType = 'tv';
            document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.genre-btn[data-id=""]').classList.add('active');
            loadLibrary();
        } else if (section === 'home') {
            searchInput.value = '';
            currentGenre = '';
            currentMediaType = 'all';
            document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.genre-btn[data-id=""]').classList.add('active');
            loadLibrary();
        } else if (section === 'mylist') {
            searchInput.value = '';
            loadMyListPage();
        }
    });
});

// Sync trigger (sidebar button)
window.triggerSync = async function(e) {
    e.preventDefault();
    syncLabel.textContent = 'Syncing...';
    try {
        await smartFetch(`${API_BASE}/api/sync/full`, { method: 'POST' });
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

loadLibrary().then(() => {
    initTVNavigation();
});
