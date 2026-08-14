// remote-logger.js — Live Remote Telemetry & UI Monitoring for Android TV
// Sends all client logs, D-Pad remote events, click latencies, and errors to PC server

const PC_LOGGER_URL = 'https://movies.caffegelato-arusha.com/api/log';

class RemoteLogger {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.initListeners();
    }

    send(type, tag, message, details = null, latency = null) {
        const payload = {
            type,
            tag,
            message: String(message),
            details,
            latency,
            timestamp: new Date().toISOString()
        };

        // Also print locally in WebView console
        const prefix = `[TV-${type.toUpperCase()}]`;
        if (type === 'error') console.error(prefix, tag, message, details);

        // Queue log entry for non-blocking HTTP dispatch
        this.queue.push(payload);
        this.flushQueue();
    }

    async flushQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            try {
                if (navigator.sendBeacon) {
                    const blob = new Blob([JSON.stringify(item)], { type: 'application/json' });
                    navigator.sendBeacon(PC_LOGGER_URL, blob);
                } else {
                    await fetch(PC_LOGGER_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(item),
                        keepalive: true
                    });
                }
            } catch (e) {
                // Silently swallow network logger failures to prevent logging loops
            }
        }
        this.isProcessing = false;
    }

    initListeners() {
        // 1. Unhandled Errors
        window.addEventListener('error', (e) => {
            this.send('error', 'UNCATCH_ERROR', e.message, {
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno,
                stack: e.error ? e.error.stack : null
            });
        });

        // 2. Unhandled Promise Rejections
        window.addEventListener('unhandledrejection', (e) => {
            this.send('error', 'PROMISE_REJECT', e.reason ? (e.reason.message || e.reason) : 'Unhandled rejection');
        });

        // 3. Remote Keydown Events (D-Pad Remote Input)
        window.addEventListener('keydown', (e) => {
            const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'GoBack', 'Back'];
            if (keys.includes(e.key)) {
                const active = document.activeElement;
                const activeDesc = active ? `${active.tagName}#${active.id || ''}.${active.className || ''}` : 'none';
                this.send('key', 'REMOTE_DPAD', `Key: ${e.key}`, { focusedElement: activeDesc });
            }
        });

        // 4. Click Events & Latency Measurement
        window.addEventListener('click', (e) => {
            const target = e.target.closest('a, button, [tabindex="0"], .movie-card, .genre-btn');
            if (target) {
                const targetDesc = `${target.tagName}#${target.id || ''}.${target.className || ''}`.trim();
                const label = target.textContent.trim().slice(0, 30);
                this.send('click', 'UI_CLICK', `Clicked: ${targetDesc} ("${label}")`);
            }
        }, true);

        // 5. Focus Changes (Live UI spatial navigation monitoring)
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            if (target) {
                const targetDesc = `${target.tagName}#${target.id || ''}.${target.className || ''}`.trim();
                this.send('focus', 'UI_FOCUS', `Focused: ${targetDesc}`);
            }
        });
    }
}

export const logger = new RemoteLogger();
