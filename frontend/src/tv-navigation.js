// tv-navigation.js — Spatial Navigation for Android TV D-Pad remote control

export function initTVNavigation() {
    console.log("📺 [TV Navigation] Spatial navigation initialized.");

    // Listen for keydown events
    window.addEventListener('keydown', (e) => {
        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
        if (!keys.includes(e.key)) return;

        const active = document.activeElement;

        // Special handling for Search Input
        if (active && active.id === 'movie-search') {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                // Let standard cursor navigation work in text input
                return;
            }
            if (e.key === 'Enter') {
                // Blur search input and focus default content
                active.blur();
                e.preventDefault();
                focusDefault();
                return;
            }
        }

        // Special handling for HTML Select element
        if (active && active.tagName === 'SELECT') {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                // Let user select dropdown options without moving spatial focus
                return;
            }
        }

        if (e.key === 'Enter') {
            if (active && typeof active.click === 'function') {
                active.click();
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'Escape') {
            // Close modals on Escape (TV Back Button mapped to Escape/Back)
            const closePlayer = document.getElementById('close-player');
            const closeDetail = document.getElementById('close-detail');
            const playerModal = document.getElementById('player-modal');
            const detailModal = document.getElementById('detail-modal');

            if (playerModal && playerModal.classList.contains('active')) {
                closePlayer.click();
                e.preventDefault();
            } else if (detailModal && detailModal.classList.contains('active')) {
                closeDetail.click();
                e.preventDefault();
            }
            return;
        }

        // Arrow Key directional navigation
        const direction = e.key.replace('Arrow', '').toLowerCase(); // 'up', 'down', 'left', 'right'
        navigate(direction, e);
    });

    // Automatically focus default element on load
    setTimeout(focusDefault, 1000);
}

function getFocusableElements() {
    const selector = 'a, button, input, select, textarea, [tabindex="0"]';
    const elements = Array.from(document.querySelectorAll(selector));

    const filtered = elements.filter(el => {
        // Must not be disabled
        if (el.disabled) return false;

        // Check if element is visible
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

        // Ensure element has size
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;

        // If a modal overlay is active, restrict focus only to elements inside it
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) {
            return activeModal.contains(el);
        }

        // Otherwise, ignore any focusable elements nested in inactive modals
        if (el.closest('.modal-overlay:not(.active)')) return false;

        return true;
    });

    return filtered;
}

function focusDefault() {
    const candidates = getFocusableElements();
    if (candidates.length === 0) return;

    // Default priority:
    // 1. First visible item inside active modal (if a modal is open)
    // 2. Play button or Watch Now
    // 3. First movie card
    // 4. First navbar item
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) {
        const modalCandidates = candidates.filter(el => activeModal.contains(el));
        if (modalCandidates.length > 0) {
            modalCandidates[0].focus();
            return;
        }
    }

    const firstMovie = document.querySelector('#movie-grid .movie-card');
    if (firstMovie) {
        firstMovie.focus();
        return;
    }

    const firstNav = document.querySelector('.sidebar-nav-items .nav-item');
    if (firstNav) {
        firstNav.focus();
        return;
    }

    candidates[0].focus();
}

function navigate(direction, e) {
    const candidates = getFocusableElements();
    let current = document.activeElement;

    console.log(`📺 [TV Navigation] Key: ${e.key}, Direction: ${direction}`);
    console.log(`📺 [TV Navigation] Current active element:`, current);
    console.log(`📺 [TV Navigation] Candidates count: ${candidates.length}`);

    // If nothing is focused, default focus first candidate
    if (!current || !candidates.includes(current)) {
        console.log(`📺 [TV Navigation] No active element or active element not in candidates. Focusing default.`);
        focusDefault();
        e.preventDefault();
        return;
    }

    const currentRect = current.getBoundingClientRect();
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    console.log(`📺 [TV Navigation] Current Center: (${cx}, ${cy})`, currentRect);

    let bestCandidate = null;
    let bestScore = Infinity;

    for (const candidate of candidates) {
        if (candidate === current) continue;

        const candidateRect = candidate.getBoundingClientRect();
        const tx = candidateRect.left + candidateRect.width / 2;
        const ty = candidateRect.top + candidateRect.height / 2;

        const dx = tx - cx;
        const dy = ty - cy;

        // Strict boundary checking to verify candidate lies in the requested direction
        let isCorrectDirection = false;
        switch (direction) {
            case 'left':
                isCorrectDirection = dx < -1;
                break;
            case 'right':
                isCorrectDirection = dx > 1;
                break;
            case 'up':
                isCorrectDirection = dy < -1;
                break;
            case 'down':
                isCorrectDirection = dy > 1;
                break;
        }

        const identifier = candidate.id || candidate.className || candidate.tagName;
        
        if (!isCorrectDirection) {
            continue;
        }

        // Compute spatial score: distance + alignment penalty
        const distance = Math.sqrt(dx * dx + dy * dy);
        let alignmentPenalty = 0;

        if (direction === 'left' || direction === 'right') {
            alignmentPenalty = Math.abs(dy) * 2.5; // Heavily penalize vertical drift when moving horizontally
        } else {
            alignmentPenalty = Math.abs(dx) * 2.5; // Heavily penalize horizontal drift when moving vertically
        }

        const score = distance + alignmentPenalty;
        console.log(`   Candidate: [${identifier}], Center: (${tx}, ${ty}), dx: ${dx.toFixed(1)}, dy: ${dy.toFixed(1)}, distance: ${distance.toFixed(1)}, penalty: ${alignmentPenalty.toFixed(1)}, score: ${score.toFixed(1)}`);

        if (score < bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    if (bestCandidate) {
        console.log(`📺 [TV Navigation] Focused best candidate:`, bestCandidate);
        bestCandidate.focus();

        // Custom scroll adjustments to ensure proper alignment
        bestCandidate.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest'
        });

        e.preventDefault();
    } else {
        console.log(`📺 [TV Navigation] No suitable candidate found in direction: ${direction}`);
    }
}
