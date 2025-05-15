# StayOnStreamer

A Tampermonkey userscript for Twitch that normalizes the offline viewing experience, automatically expands livestreams, and prevents unwanted raid redirects.
For afk channel points farm when streamer goes live or keeping offline chat logs open.

## Features

-  Auto-expands stream view when a followed streamer goes live
-  Blocks Twitch's "video roulette" when a streamer is offline
-  Automatically returns to original channel after raids/redirects
-  Draggable overlay when watching an offline channel
-  Persistent channel list stored in your browser
-  Built-in debug tools and easy management via the browser console

## How It Works

- The script only activates on channels **you choose**
- It ensures the Twitch page reflects the correct live/offline state
- If a streamer goes live while the page is open, it auto-clicks to expand the stream
- If you're redirected by a raid or host, it quietly returns you to the right channel
- When the streamer is offline, a subtle overlay appears to show the script is actively watching

## Installation

1. Install Tampermonkey (or a similar userscript manager)
2. Add this userscript via raw URL or by pasting it into a new script
3. Visit Twitch, open your favorite streamers’ channels, and add them to your list via console

---

## 💬 Console Commands

After installation, open the browser dev console on Twitch and use:

```js
stayonstreamer.add('name')     // Add a channel (auto-lowercased)
stayonstreamer.remove('name')  // Remove a channel
stayonstreamer.list()          // See current watched channels
stayonstreamer.debug()         // Show live debug info
