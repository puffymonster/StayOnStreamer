// ==UserScript==
// @name         Stay on Streamer v3.476
// @namespace    http://tampermonkey.net/
// @version      3.476
// @description  Auto-normalises Twitch offline view, prevents channel roulette, expands stream when live, returns after raids,  adds a draggable overlay.
// @match        https://www.twitch.tv/*
// @grant        none
// ==/UserScript==

// StayOnStreamer: Auto-manage Twitch viewing state for selected channels.
// - Only runs on channels in your saved list (stayonstreamer.list/add/remove)
// - Handles Twitch's quirks: "offline roulette" (VODs, random live content), sticky video player, etc.
// - On page load, script clicks channel name to "normalize" the view:
//     - If streamer is offline, shows real offline banner (avoids roulette content).
//     - If streamer is live, script clicks twice to ensure true live view is active.
// - Observes DOM for streamer going live and automatically expands view.
// - If you are redirected by a raid or recommended channel, returns you to original channel with cooldown.

// === StayOnStreamer: Console Commands ===

// Use these in your browser dev console to manage your channel list or debug:
//   stayonstreamer.list()         // View your current channel list
//   stayonstreamer.add('name')    // Add a channel (replace 'name' with streamer)
//   stayonstreamer.remove('name') // Remove a channel
//   stayonstreamer.debug()        // Show live debug info (state, channel, badge, etc)
//
// Changes are saved instantly. Channel names are auto-lowercased. Page reload recommended after edits.

/* eslint no-multi-spaces: "off" */
/* eslint curly: "off" */

(function () {
    'use strict';

    const CHANNELS_KEY = 'stayOnStreamerChannels';

    // Get the user's persistent list of channels, with error handling and defaults
    function getChannels() {
        const defaultChannels = [];
        let saved;
        try {
            saved = localStorage.getItem(CHANNELS_KEY);
            if (!saved) throw new Error('No channel list in storage');
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.some(s => typeof s !== 'string')) throw new Error('Channel list is invalid');
            return parsed;
        } catch (e) {
            console.error('[StayOnStreamer] Channel list corrupted or missing! Using defaults.', e);
            setChannels(defaultChannels);
            return defaultChannels;
        }
    }

    // Save channels list to storage, always lowercased
    function setChannels(list) {
        localStorage.setItem(CHANNELS_KEY, JSON.stringify(list.map(s => s.toLowerCase())));
    }

    // Expose dev console commands for channel list management and debugging
    window.stayonstreamer = {
        list: () => getChannels(),
        add: (name) => {
            if (typeof name !== 'string' || !name.trim()) return;
            name = name.trim().toLowerCase();
            let list = getChannels();
            if (!list.includes(name)) {
                list.push(name);
                setChannels(list);
            }
            return list;
        },
        remove: (name) => {
            if (!name) return;
            let list = getChannels();
            name = name.toLowerCase();
            if (list.includes(name)) {
                list = list.filter(n => n !== name);
                setChannels(list);
            }
            return list;
        },
        debug: () => {
            console.group('[StayOnStreamer] Debug Info');
            try {
                const list = getChannels();
                console.log('Channels List:', list);
                console.log('Current Channel:', CH);
                console.log('Current URL:', location.href);
                console.log('Is Channel Watched:', list.includes(CH));
                console.log('Live badge present:', !!document.querySelector(BADGE));
                console.log('ClickedOnce:', clickedOnce);
                console.log('Reclicked:', reclicked);
                console.log('WasLive:', wasLive);
                console.log('SuppressTil:', suppressTil, suppressTil ? new Date(suppressTil).toLocaleTimeString() : '');
            } catch (e) {
                console.error('[StayOnStreamer] Debug error:', e);
            }
            console.groupEnd();
        },
    };

    // --- Initialization and basic checks ---
    const CHANNELS = getChannels();
    const parts = location.pathname.split('/');
    const CH    = (parts[1] || '').toLowerCase();
    if (!CHANNELS.includes(CH)) return; // Run only on listed channels

    // --- Twitch DOM Selectors ---
    const BASE  = `https://www.twitch.tv/${CH}`;
    const BADGE = '.tw-channel-status-text-indicator';
    const TITLE = 'h1.tw-title';

    // --- State variables ---
    let clickedOnce = false;
    let reclicked   = false;
    let wasLive     = false;
    let suppressTil = 0;
    let liveStatusObserver = null;
    let statusOverlay = null;

    // Shows the overlay on the offline banner when watching for live stream
    function showStatusOverlay() {
        const banner = document.querySelector('[data-a-target="player-overlay-click-handler"]');
        const overlayStyle = () => {
            return `
                position: absolute;
                left: 20px;
                bottom: 20px;
                background: rgba(25,25,25,0.94);
                color: #00ffae;
                padding: 10px 16px;
                font-size: 14px;
                font-family: monospace;
                border-radius: 10px;
                border: 1px solid #00ffae;
                z-index: 10;
                pointer-events: auto;
                user-select: none;
                cursor: move;
                max-width: 90vw;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                align-self: flex-start;
                flex: none;
                order: -1;
            `;
        };
        if (!statusOverlay) {
            statusOverlay = document.createElement('div');
            statusOverlay.id = 'stayOnStreamerOverlay';
            statusOverlay.textContent = '👀 StayOnStreamer: Watching for live stream…';
            // Add reset position button to overlay
            const resetBtn = document.createElement('span');
            resetBtn.textContent = '↺';
            resetBtn.title = 'Reset position';
            resetBtn.style.cssText = 'margin-left:10px;cursor:pointer;color:#00ffaa;font-weight:bold;';
            resetBtn.onclick = (e) => {
                e.stopPropagation();
                statusOverlay.style.left = '20px';
                statusOverlay.style.top = '';
                statusOverlay.style.right = '';
                statusOverlay.style.bottom = '20px';
            };
            statusOverlay.appendChild(resetBtn);
            statusOverlay.style.cssText = overlayStyle();
            // Drag-to-move logic (bounded within banner)
            let isDragging = false;
            let offsetX = 0, offsetY = 0;
            let dragBannerRect = null;
            let mousemoveHandler = null, mouseupHandler = null;
            statusOverlay.addEventListener('mousedown', (e) => {
                if (e.target === resetBtn) return;
                isDragging = true;
                dragBannerRect = (banner ? banner.getBoundingClientRect() : {left:0, top:0, width:window.innerWidth, height:window.innerHeight});
                const rect = statusOverlay.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                statusOverlay.style.transition = 'none';
                e.preventDefault();
                mousemoveHandler = (ev) => {
                    let br = dragBannerRect;
                    const x = ev.clientX - br.left - offsetX;
                    const y = ev.clientY - br.top - offsetY;
                    const maxX = br.width - statusOverlay.offsetWidth;
                    const maxY = br.height - statusOverlay.offsetHeight;
                    statusOverlay.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
                    statusOverlay.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
                    statusOverlay.style.bottom = '';
                    statusOverlay.style.right = '';
                };
                mouseupHandler = () => {
                    isDragging = false;
                    document.removeEventListener('mousemove', mousemoveHandler);
                    document.removeEventListener('mouseup', mouseupHandler);
                };
                document.addEventListener('mousemove', mousemoveHandler);
                document.addEventListener('mouseup', mouseupHandler);
            });
        }
        // Attach overlay to banner, fallback to window if not found
        if (banner) {
            if (getComputedStyle(banner).position === 'static') {
                banner.style.position = 'relative';
            }
            statusOverlay.style.position = 'absolute';
            if (!banner.contains(statusOverlay)) banner.appendChild(statusOverlay);
        } else {
            statusOverlay.style.position = 'fixed';
            statusOverlay.style.left = '20px';
            statusOverlay.style.bottom = '20px';
            statusOverlay.style.top = '';
            statusOverlay.style.right = '';
            statusOverlay.style.zIndex = 9999;
            if (!document.body.contains(statusOverlay)) document.body.appendChild(statusOverlay);
        }
        statusOverlay.style.display = '';
    }

    // Hides the overlay
    function hideStatusOverlay() {
        if (statusOverlay) statusOverlay.style.display = 'none';
    }

    // Waits for a number of milliseconds using requestAnimationFrame
    const waitFrames = (ms, callback) => {
        const start = performance.now();
        function loop(timestamp) {
            if (timestamp - start >= ms) {
                callback();
            } else {
                requestAnimationFrame(loop);
            }
        }
        requestAnimationFrame(loop);
    };

    // Logs with color-coded booleans (true/false) for easier reading
    function logWithColoredBools(msg, ...values) {
        if (typeof msg !== 'string') {
            let text;
            try { text = JSON.stringify(msg, null, 2); } catch { text = String(msg); }
            const parts = text.split(/(true|false)/g);
            let outStr = '', styles = [];
            parts.forEach(part => {
                if (part === 'true')      { outStr += '%ctrue';  styles.push('color:green;font-weight:bold'); }
                else if (part === 'false'){ outStr += '%cfalse'; styles.push('color:red;font-weight:bold'); }
                else                      { outStr += '%c' + part; styles.push('color:white'); }
            });
            outStr = '%c[StayOnStreamer:' + CH + '] ' + outStr;
            styles.unshift('color:white;font-weight:bold');
            console.log(outStr, ...styles);
            return;
        }
        let interpolated = msg;
        if (values.length) {
            values.forEach((val, i) => {
                const token = new RegExp('\\{' + i + '\\}', 'g');
                interpolated = interpolated.replace(token, val);
            });
        }
        const parts = interpolated.split(/(true|false)/g);
        let outStr = '', styles = [];
        parts.forEach(part => {
            if (part === 'true')      { outStr += '%ctrue';  styles.push('color:green;font-weight:bold'); }
            else if (part === 'false'){ outStr += '%cfalse'; styles.push('color:red;font-weight:bold'); }
            else                      { outStr += '%c' + part; styles.push('color:white'); }
        });
        outStr = '%c[StayOnStreamer:' + CH + '] ' + outStr;
        styles.unshift('color:white;font-weight:bold');
        console.log(outStr, ...styles);
    }

    // Waits for a DOM selector to appear before running a callback
    const waitFor = (sel, cb, to=15000) => {
        const st = Date.now();
        const iv = setInterval(() => {
            const el = document.querySelector(sel);
            if (el) { clearInterval(iv); cb(el); }
            else if (Date.now() - st > to) {
                clearInterval(iv);
                logWithColoredBools(`waitFor: selector "${sel}" not found within ${to}ms`);
            }
        }, 250);
    };

    // Main sequence: normalise view, check live, show overlay, set up observers
    waitFor(TITLE, (t1) => {
        function tryNormaliseClick(retries = 20, delay = 250) {
            if (retries <= 0) {
                logWithColoredBools('❌ Failed to normalise view after multiple attempts.');
                return;
            }
            if (clickedOnce) return;
            requestAnimationFrame(() => {
                const t = document.querySelector(TITLE);
                const current = t?.textContent?.trim().toLowerCase();
                const clickable = t && typeof t.click === 'function';
                if (!clickedOnce && current === CH && clickable && t.offsetParent !== null) {
                    logWithColoredBools(`1st click → normalise view (attempt ${21 - retries})`);
                    t.click();
                    clickedOnce = true;
                } else if (!clickedOnce) {
                    setTimeout(() => tryNormaliseClick(retries - 1, delay), delay);
                }
            });
        }
        tryNormaliseClick();
        waitFrames(2000, () => {
            wasLive = !!document.querySelector(BADGE);
            logWithColoredBools(`LIVE badge at startup: ${wasLive}`);
            if (!wasLive) showStatusOverlay();
            else hideStatusOverlay();
            // If stream is already live, restore to full view
            if (wasLive && !reclicked) {
                waitFor(TITLE, (t2) => {
                    if (t2.textContent.trim().toLowerCase() === CH) {
                        logWithColoredBools('2nd click → restore full stream');
                        t2.click();
                        reclicked = true;
                        waitFrames(1500, () => {
                            const vid = document.querySelector('video');
                            if (!reclicked && (!vid || vid.offsetHeight < 100)) {
                                logWithColoredBools('⚠️ Live failsafe: banner view detected, clicking title again');
                                waitFor(TITLE, (t3) => {
                                    if (t3.textContent.trim().toLowerCase() === CH) {
                                        t3.click();
                                        logWithColoredBools('✅ Live failsafe: restored full stream view');
                                    }
                                });
                            }
                        });
                    }
                });
            }
            // Observe DOM changes for future live status transitions
            if (!liveStatusObserver) {
                liveStatusObserver = new MutationObserver(() => {
                    if (Date.now() < suppressTil) return;
                    const liveNow = !!document.querySelector(BADGE);
                    // If stream goes live, auto-expand view
                    if (!wasLive && liveNow && !reclicked) {
                        logWithColoredBools('Stream went LIVE – skipping click to avoid banner view');
                        reclicked = true;
                    }
                    wasLive = liveNow;
                    if (!liveNow) showStatusOverlay();
                    else hideStatusOverlay();
                });
                liveStatusObserver.observe(document.body, {childList:true, subtree:true});
            }
        });
    });

    // Periodically check if redirected by a raid/auto-host and return to base
    setInterval(() => {
        const ok = ['', '/', '/chat', '/videos', '/about', '/schedule']
        .some(s => location.href.startsWith(`${BASE}${s}`));
        if (!ok) {
            logWithColoredBools('Raid detected → returning + cooldown');
            location.href = BASE;
            suppressTil = Date.now() + 15000;
            reclicked = false;
        }
    }, 5000);
})();
