# Aqua Launcher — Feature Ideas for Review

**Status:** proposal only. Nothing in this document has been implemented.
**Reviewed against:** the current `main` tree (Electron 45 + React 19 + Vite), including the launcher core, IPC surface, and all nine pages.

This is a deliberately broad catalogue. The goal is to give you enough options to pick a direction, not to claim every idea belongs in v1. IDs are stable, so you can reply with things like "do A2, D1, B6 — skip the rest" and the list stays useful as a reference.

**Effort:** `S` under a day · `M` 1–3 days · `L` 1–2 weeks · `XL` a new subsystem / multi-week
**Impact:** how much it improves trust, usefulness, or delight for a typical player

**Review tip:** mark each line ✅ (build), 🤔 (maybe later), or ❌ (not interested). The shortlist and phases at the end are only suggestions.

---

## What the launcher already covers

So we don't spend effort rebuilding it:

- Dashboard, installations, versions, worlds, servers, extra content, accounts, logs, settings.
- Offline profiles and a complete but UI-gated Microsoft OAuth backend.
- Fabric, Quilt, Forge, NeoForge; Mojang runtime provisioning; integrity-checked installs and repair.
- Modrinth search/install/update for mods, modpacks, resource packs, and shaders with SHA-1 matching.
- World metadata, ZIP backups, non-destructive restores.
- Java Server List Ping, Bedrock RakNet ping, Quick Play joins, Bedrock deep links.
- Bedrock Store detection, version catalogue/download/registration, add-on import and an in-app add-on browser.
- Per-installation memory, Java, window, JVM/game args and game directory overrides.
- Custom block themes, themes/accents, UI scale, reduced motion, artwork from Mojang drops.
- Atomic JSON persistence, job manager, download concurrency/bandwidth limits, activity history, startup-in-tray.

The gaps below are mostly about **trust** (recovery, backups, verification), **depth** (content and server tooling), and **reach** (platform integration, accessibility, localization).

---

## My top 12, in the order I'd build them

| # | Idea | Why it earns a slot | Effort |
|---|------|--------------------|--------|
| 1 | **A2 + A1** Crash Guard and Safe Mode | Turns the worst moment (game crashed, no idea why) into a guided fix. Biggest trust win available. | M–L |
| 2 | **D1** Scheduled world backups | Data loss is the one mistake users never forgive. README currently lists this as a limitation. | M |
| 3 | **A4** Instance health check | One screen that answers "is this profile actually healthy?", with one-click fixes. | M |
| 4 | **H1 + H2** Disk usage and cleanup | Minecraft folders grow to tens of GB; users cannot see what is safe to delete. | M–L |
| 5 | **B4 + B5** Local jar inspector and conflict checker | Modrinth-matched files are understood; hand-installed jars are anonymous. This closes that gap. | M–L |
| 6 | **I1** Launcher auto-update | Without it, every future fix depends on users manually reinstalling. | M–L |
| 7 | **F4** Screenshot gallery | Cheap, visible, and genuinely useful after every session. | M |
| 8 | **I3 + I2** Import from other launchers, portable mode | Removes the biggest barrier to switching launchers. | L |
| 9 | **F1 + F2** Command palette and global search | Makes a launcher with this many surfaces feel small and fast. | S–M |
| 10 | **B1 + B2** Mod detail pane and real search filters | The current browser is a search box; this makes it a catalogue. | M |
| 11 | **C7 + C8** LAN world discovery and per-server instance binding | Two small changes that remove daily friction. | S–M |
| 12 | **I6** Discord Rich Presence | Free social presence; players already expect it. | M |

---

## A. Launch, stability, and performance

*The launcher is the last thing between a player and the game. Every minute saved or failure explained here is worth more than another settings toggle.*

**A1 · Safe Mode launch** — `Effort M · Impact high`
Launch an instance with mods, resource packs, and shader packs temporarily disabled, without destroying the user's setup. A "restore after launch" switch puts everything back when the game exits. This is the standard escape hatch when a new mod bricks startup.

**A2 · Crash Guard** — `Effort L · Impact high`
On a non-zero game exit, classify the failure instead of just showing a red toast: out of memory, missing dependency, Java version mismatch, mixin/loader crash, bad graphics driver, corrupted install. Each class gets specific actions (raise RAM, open the suspect mod, install Java 8, verify files, restore last snapshot). Builds on the existing crash-report and log capture.

**A3 · Launch snapshots and one-click rollback** — `Effort L · Impact high`
Before each launch, record a lightweight snapshot of the mods list and small config files (hashes + copies). If the next launch crashes, offer "undo the last change". Keep the last 3–5 snapshots. Deliberately excludes worlds.

**A4 · Instance health check** — `Effort M · Impact high`
One page per installation: Java detected and compatible, memory sane, disk space, installed file integrity, loader/MC version match, duplicate mods, missing dependencies, orphaned files, game directory writable, last install age. Each row gets a fix action or a plain-English explanation.

**A5 · Pre-launch checklist** — `Effort S–M · Impact high`
Configurable checks before Play: low disk, RAM allocated above ~70% of system memory, 32-bit Java, Java 8 needed for 1.12.2, offline account joining an online-mode server, mod count/RAM mismatch, missing assets. Warn once per session, not on every click.

**A6 · JVM preset library** — `Effort S · Impact medium`
Named presets with explanations: Aikar's flags, Generational ZGC, G1 tuning, low-memory laptop, vanilla. Validate against the selected Java major version and show which flags were ignored. Advanced users keep the raw editor.

**A7 · Smarter RAM recommendation** — `Effort S · Impact medium`
Estimate a sensible max from installed RAM, mod count, and pack size; warn when allocation is too low for the pack or high enough to starve Windows. Explain the trade-off in one sentence instead of a slider with no context.

**A8 · Process controls** — `Effort M · Impact medium`
"Stop game" with a graceful close first, then force-kill; CPU priority; GPU preference on Windows; show PID, uptime, and memory in the running panel. Optional "close launcher when the game starts" and "reopen when it exits" (the latter exists).

**A9 · Launch guard and queue** — `Effort S · Impact medium`
Prevent accidental double launches, queue a second request, and support "launch as soon as the install/update finishes". Useful for big modpack installs where Play is pressed twice.

**A10 · Playtime and session analytics** — `Effort M · Impact medium`
A stats page from the existing session/activity data: total and per-instance playtime, sessions this week, most-played versions/servers, a calendar heatmap, streaks, and CSV export. No account or cloud needed.

**A11 · Resume where you left off** — `Effort S · Impact medium`
Restore the last page, last selected installation, window position/size, and monitor. Today the app opens on the active Java installation regardless of what the user was doing.

**A12 · Content update policy before launch** — `Effort M–L · Impact medium`
Per-instance policy for mods and modpacks: off / notify / auto-update. Pinned mods and disabled files are excluded. Runs as a normal background job so Play is not blocked unless the user chooses to wait.

**A13 · Resumable, reorderable downloads** — `Effort M · Impact medium`
HTTP Range resume for interrupted files, pause/resume for the whole queue, drag-to-reorder, retry-failed, and a speed/ETA graph. The bounded-concurrency downloader and job manager already provide the foundation.

**A14 · Mirror and proxy support** — `Effort M · Impact medium`
Configurable HTTP/SOCKS proxy plus optional mirror for manifests, libraries, and assets, with the same SHA-1 verification. Helps players where Mojang's CDN is slow or blocked. Mirrors stay opt-in and clearly labelled.

**A15 · Offline resilience** — `Effort M · Impact medium`
Use cached manifests and version JSON when the network is down, show a clear "you can still play these installed versions" path, and distinguish auth failure from network failure in every error.

**A16 · Crash knowledge base** — `Effort M · Impact high`
A local, versioned set of rules mapping common stack-trace signatures (mixin apply failed, NoClassDefFoundError, GLFW error, watchdog timeout, `java.lang.OutOfMemoryError`) to plain-English causes and fixes. No telemetry and no external service required.

**A17 · Explain Java selection** — `Effort M · Impact medium`
Show which JRE was picked for a launch and why (version requirement, loader override, per-instance override), with a one-click pin. Warn on 32-bit builds and on Java versions newer than the mod loader supports.

**A18 · Integrity report after launch** — `Effort S · Impact low–medium`
A compact post-session summary: duration, exit code, peak memory if available, warnings count, and a link to the log. Makes the activity feed feel alive without adding noise.

---

## B. Mods, packs, and content

*The Modrinth integration is good but shallow. Most of the value is in making installed content legible and making unusual files (hand-installed jars, local packs, datapacks) first-class.*

**B1 · Mod detail pane** — `Effort M · Impact high`
Full project view before installing: description, gallery, changelog, all versions, dependencies, license, source/issues links, client/server side, and "install this specific version". Today the browser shows a card and an install button.

**B2 · Real search filters and sorting** — `Effort M · Impact high`
Categories, loader, Minecraft version, environment (client/server), license, and sort by relevance/downloads/follows/newest/updated. Pagination or infinite scroll, plus remembered filters per content type. Modrinth's API already supports facets.

**B3 · Featured collections** — `Effort S–M · Impact medium`
Curated rows: performance, quality-of-life, vanilla+, horror, tech, magic, adventure. Can start as a static local list of project IDs and later become remote JSON. Gives the empty search state somewhere to go.

**B4 · Local jar inspector** — `Effort M · Impact high`
Read `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`, and `mcmod.info` to show the real name, version, authors, loader, Minecraft range, and declared dependencies for every jar, including files installed by hand. Detect duplicate mod IDs and jars built for the wrong loader/version.

**B5 · Dependency and conflict checker** — `Effort L · Impact high`
Flag missing required dependencies, version conflicts, duplicate mod IDs, client-only mods on a server profile, and a small curated list of known-incompatible pairs. Explain the problem in terms of the mods the user actually sees, not Maven coordinates.

**B6 · Drag-and-drop import** — `Effort S–M · Impact high`
Drop jars, `.zip` resource/shader packs, `.mrpack`, `.mcpack`, `.mcaddon`, or folders anywhere in the window; route by type, detect duplicates, and confirm before writing. Removes the file-picker round trip.

**B7 · Local modpack import** — `Effort L · Impact high`
Import `.mrpack`, CurseForge zip packs, Prism/MultiMC instance folders, and packwiz `pack.toml` packs. Resolve the loader/version from the pack metadata instead of asking the user to retype it.

**B8 · Modpack export and sharing** — `Effort M · Impact medium`
Export an instance as a `.mrpack` (mods + config/overrides, optional worlds excluded by default) or as a plain folder bundle. Import it back on another PC. No server or account required.

**B9 · Modpack update check** — `Effort L · Impact medium`
Compare the installed pack version with the newest compatible release, show the changelog, and update while preserving user-added mods and config edits where possible. Today packs are updated by installing a new pack version, which is safe but opaque.

**B10 · Mod sets (profiles within an instance)** — `Effort L · Impact medium`
Named groups of enabled mods ("Vanilla+", "Tech", "Testing") that can be switched before launch. Useful for debugging and for sharing one world between different play styles.

**B11 · Per-mod update policy** — `Effort M · Impact medium`
Pin a mod to its current version, ignore updates, choose release/beta/alpha, or allow auto-update. The global "update all" flow already exists; this adds control.

**B12 · Datapacks** — `Effort M · Impact medium`
Browse Modrinth datapacks, install into a chosen world's `datapacks` folder, enable/disable, and validate `pack.mcmeta`. Datapacks are currently outside the four supported content types.

**B13 · Resource pack ordering** — `Effort M · Impact medium`
Drag-to-reorder with the same precedence Minecraft uses, reading/writing `options.txt`, showing pack format and compatibility, and warning about packs built for another game version.

**B14 · Shader helper** — `Effort M–L · Impact medium`
Detect shaderpacks, install Iris + Sodium as a matched pair, show shader settings files, and offer a "performance" vs "quality" starting point. Avoid pretending to support OptiFine shaders on Fabric without Iris.

**B15 · One-click performance setup** — `Effort M · Impact high`
Create or upgrade an instance with Fabric + Sodium/Lithium/ImmediatelyFast (or the NeoForge equivalents), version-matched and explained. A large share of users want exactly this and do not know the mod names.

**B16 · Mod config editor** — `Effort M · Impact medium`
Open common config formats (`.toml`, `.json`, `.properties`) in a safe editor with validation, backup-on-save, and "reset to default". A simpler v1 can just open the config folder and the specific file.

**B17 · Mod provenance and notes** — `Effort S–M · Impact medium`
Show "installed as a dependency of X", the date/source of installation, and a free-text note per file. Answers the perennial "why is this jar here?" question.

**B18 · Instance content diff** — `Effort M · Impact medium`
Compare two installations' mods and config folders side by side, showing what exists only in one profile and copying missing files across. This is the fastest way to answer "why does this pack work there but not here?" without duplicating a whole instance.

**B19 · CurseForge / FTB sources** — `Effort L · Impact medium`
Optional additional catalogues. Requires an API key and terms review for CurseForge; FTB has its own API. Worth doing only if users ask for specific packs that Modrinth does not host.

**B20 · OptiFine handling** — `Effort S · Impact low–medium`
Detect OptiFine jars, explain the Fabric/Forge conflicts, and point at Sodium/Iris alternatives. Avoid silently installing or patching OptiFine.

---

## C. Servers

*The current server list is a ping board. The natural next step is making Aqua the place where a server is configured, started, and joined — not just remembered.*

**C1 · Local server manager** — `Effort XL · Impact high`
Create and run Paper, Vanilla, Fabric, Forge, or NeoForge servers from the launcher: choose version, accept EULA, allocate RAM, start/stop/restart, auto-restart on crash, live console, and a crash log. Reuses the existing Java service and downloader. This is the largest single feature in the document.

**C2 · `server.properties` editor** — `Effort M · Impact high`
Validated form for the common settings (MOTD with colour preview, difficulty, gamemode, view distance, simulation distance, whitelist, online-mode, port), with a raw editor for everything else and a backup before save.

**C3 · Plugin manager** — `Effort L · Impact high`
Browse Modrinth plugins, install/update/remove into the server's `plugins` folder, check dependencies and server-software compatibility, and restart to apply. Mirrors the existing mod flow.

**C4 · Whitelist, ops, and bans** — `Effort M · Impact medium`
Edit `whitelist.json`, `ops.json`, `banned-players.json`, and `banned-ips.json` with player-name lookup, UUID resolution, and clear confirmation. No hand-editing JSON.

**C5 · Server backups** — `Effort M · Impact high`
Scheduled ZIP backups of `world`, `world_nether`, `world_the_end`, and config folders, with retention and restore-as-copy. Same safety model as world backups.

**C6 · Server console and RCON** — `Effort L · Impact medium`
Live log tail, command input, connected-player list, and TPS/memory where the server exposes it. Requires a clear security model for storing RCON passwords.

**C7 · LAN world discovery** — `Effort S–M · Impact high`
Listen for Minecraft's LAN broadcast on UDP 4445, list joinable worlds with MOTD and port, and join with Quick Play. Tiny feature, very visible in households and at LAN parties.

**C8 · Per-server instance binding** — `Effort S · Impact high`
Choose which installation launches for each saved server. Today Quick Join always uses the globally selected installation, which is wrong as soon as someone plays two modpacks.

**C9 · Ping history and graphs** — `Effort M · Impact medium`
Store latency/player-count samples, show a small sparkline per server, and optionally notify when a favourite server comes back online. Builds on the existing SLP/RakNet pings.

**C10 · Server list polish** — `Effort S–M · Impact medium`
Tags/folders, drag-to-reorder, search, copy address, share as text, and import/export Minecraft's `servers.dat`. The launcher already knows how to handle `servers.dat` for settings sync.

**C11 · MOTD formatting** — `Effort S · Impact low–medium`
Render Minecraft colour codes and formatting in server cards instead of stripping them, plus a small preview when editing. Makes the list look like the game's multiplayer screen.

**C12 · Compatibility warnings** — `Effort S · Impact high`
Before joining: server version vs instance version, modded server needs a matching loader/profile, online-mode server vs offline account, and Bedrock/Java edition mismatch. These are common, confusing failures.

**C13 · Service status widget** — `Effort S · Impact low–medium`
Mojang auth/session/multiplayer status on the dashboard, so "Minecraft is down" is distinguishable from "your launcher is broken".

**C14 · Join defaults on the dashboard** — `Effort S · Impact medium`
Remember the last server per instance, and surface a "play and join" action instead of requiring Servers → find → join every time.

**C15 · Port and firewall check** — `Effort S · Impact medium`
Before hosting, verify the chosen port is free, Java is allowed through the Windows firewall, and the server is reachable on the LAN; explain router port forwarding in plain language. Complements C1 and prevents the most common "my friends can't join" support thread.

---

## D. Worlds and backups

*Backups exist and are deliberately non-destructive, which is the right call. The missing pieces are automation, visibility, and safe recovery.*

**D1 · Scheduled backups** — `Effort M · Impact high`
Per-instance schedules: before each launch, when the game exits, daily while the launcher is open, or weekly. Retention count and size cap, with a clear "last backup" indicator on the world card. This directly closes a README limitation.

**D2 · Better backup browser** — `Effort M · Impact medium`
Notes, rename, pin, archive verification, contents preview (world name, size, file count), export/import as a standalone ZIP, and a "backup now" shortcut from the dashboard.

**D3 · Background backup service** — `Effort M · Impact medium`
Run scheduled backups while the app sits in the tray, with a pause switch and a visible "next backup" time. Depends on the existing launch-at-login/tray behavior.

**D4 · World settings editor** — `Effort M–L · Impact high`
Edit name, gamemode, difficulty, cheats, spawn point, game rules, and show the seed, using the existing NBT parser. Always writes a `.bak` first. This is the feature that saves a world whose settings were set wrong at creation.

**D5 · Duplicate, rename, and trash** — `Effort S–M · Impact medium`
Duplicate a world, rename it safely, and move deletions to a launcher-managed trash with retention instead of deleting immediately.

**D6 · World import/export** — `Effort S–M · Impact medium`
Import a zipped world folder, export a world as a ZIP with progress, and validate that `level.dat` is present before accepting it.

**D7 · World size breakdown** — `Effort M · Impact medium`
Show how much space regions, dimensions, datapacks, player data, and screenshots use; detect orphaned region files and oversized screenshots. Pairs naturally with H1.

**D8 · World map preview** — `Effort XL · Impact delight`
Render a top-down map from Anvil region files with zoom/pan and waypoints. A large, risky, visually impressive project; worth it only if it becomes a headline feature.

**D9 · Bedrock world backup/export** — `Effort M · Impact high`
ZIP a Bedrock world folder (`minecraftWorlds/<id>`) with its `level.dat`, `levelname.txt`, and icon; restore as a copy, never in place. Bedrock worlds are currently read-only, which makes them the least protected data in the app.

**D10 · Datapack manager per world** — `Effort M · Impact medium`
List, enable/disable, and validate datapacks inside a world, with compatibility warnings for the world's Minecraft version.

**D11 · Corruption check and repair** — `Effort M · Impact high`
Parse `level.dat` and region headers, detect truncation or unreadable chunks, and offer recovery from `level.dat_old` or the newest backup. At minimum, tell the user before they open a broken world.

**D12 · Backup-to-folder** — `Effort M–L · Impact medium`
Copy completed backups to a user-chosen folder (OneDrive/Dropbox/WebDAV mount) after each run. No launcher account or hosted service; the user owns the destination.

---

## E. Accounts and identity

*The backend is more capable than the UI. Most of these are about exposing what already exists safely.*

**E1 · Account switcher in the titlebar** — `Effort S–M · Impact high`
Show the active account with avatar and a dropdown to switch or add. Multi-account switching already exists in the backend; it is buried in the Account page.

**E2 · Skin and cape preview** — `Effort M · Impact delight`
Render the active account's skin (2D and a simple 3D preview) and cape from Mojang's session services, with "copy skin PNG" and "open in skin viewer". For offline profiles, preview by username where a public skin service is available. Do not promise skin upload without a server-side skin service.

**E3 · Account health panel** — `Effort S–M · Impact high`
Show token state, last refresh, "session expired" banner with one-click re-auth, and which instances depend on the account. Turns silent auth failures into obvious ones.

**E4 · Per-instance account binding** — `Effort M · Impact medium`
Attach an account to an installation (useful for testing alts or keeping a family account separate), with a global "use active account" default.

**E5 · Device-code sign-in fallback** — `Effort M · Impact medium`
When the loopback callback is blocked by a firewall or browser, offer Microsoft's device-code flow. Needs validation against the Azure application and the Minecraft scopes before it ships.

**E6 · Custom auth servers (authlib-injector)** — `Effort L · Impact medium`
Opt-in support for trusted third-party auth servers via `authlib-injector`, with a prominent warning that this is not a Mojang auth bypass and should only be used with servers the user trusts. Requires a policy decision before implementation.

**E7 · Encrypted account export** — `Effort M · Impact low–medium`
Move accounts between PCs with a passphrase-protected archive. Reuses the existing credential-store encryption; never writes plaintext tokens.

**E8 · Profile name/UUID tools** — `Effort S · Impact low`
Copy UUID, show name history where available, and explain the deterministic offline UUID so server owners can whitelist correctly.

**E9 · Account avatars everywhere** — `Effort S · Impact low–medium`
Use the active account's avatar in the dashboard, activity feed, and join confirmations. Small consistency win.

---

## F. Launcher UX, customization, and accessibility

*This is where a launcher becomes pleasant rather than merely functional.*

**F1 · Command palette** — `Effort S · Impact high`
`Ctrl+K` to navigate, launch, search settings, install a version, open a folder, or toggle a setting. The fastest quality-of-life feature in the document.

**F2 · Global search** — `Effort M · Impact high`
One search across installations, worlds, servers, installed mods, logs, and settings, with grouped results and keyboard navigation.

**F3 · Keyboard shortcuts and cheat sheet** — `Effort S–M · Impact medium`
Play, search, navigate pages, open downloads, toggle sidebar, and close dialogs; a `?` sheet listing them. Respect focus traps and text inputs.

**F4 · Screenshot gallery** — `Effort M · Impact high`
Watch each instance's `screenshots` folder (and Bedrock's equivalents), generate cached thumbnails, and offer full view, copy, open folder, delete, and "set as instance cover" or "use as dashboard background". No external service.

**F5 · Theme import/export and more presets** — `Effort S–M · Impact medium`
Export the custom block theme + accent as a JSON file, import someone else's, and add 3–5 curated presets. Per-instance accent/background would make profiles feel distinct.

**F6 · Layout customization** — `Effort M · Impact medium`
Collapse or reorder sidebar items, choose compact/comfortable density, hide dashboard sections, and remember it all. Accessibility-adjacent and cheap to appreciate.

**F7 · Notification center** — `Effort S–M · Impact medium`
A persistent list of download completions, crashes, updates, and server status changes, plus native OS notifications when the window is hidden. Toasts currently vanish.

**F8 · Tray and taskbar integration** — `Effort M · Impact medium`
Tray menu with Play, join last server, pause/resume downloads, and running status; taskbar progress for downloads; Windows jump list of recent instances. The tray currently has only Open and Quit.

**F9 · Detachable windows** — `Effort L · Impact low–medium`
Open logs, downloads, or the console in their own window so a second monitor can show diagnostics while playing. Architecturally larger because the renderer assumes one window.

**F10 · Compact mode** — `Effort M · Impact medium`
A small always-on-top window with the active instance, Play/Stop, download status, and a server quick-join, for people who keep the launcher open while doing something else.

**F11 · Accessibility pass** — `Effort M · Impact medium`
High-contrast theme, reduced transparency, visible focus order, screen-reader labels on icon-only buttons, larger hit targets, and no motion that cannot be disabled. Some of this exists; an audit would find the rest.

**F12 · Localization** — `Effort XL · Impact high`
An i18n layer with message extraction, plural/date/number handling, RTL layout support, and community translation files. The app is English-only today; this is the single biggest reach multiplier.

**F13 · What's new and onboarding tour** — `Effort S · Impact medium`
A changelog modal after updates and a short, skippable tour of new features. Pairs with auto-update; otherwise users never learn what changed.

**F14 · Optional sound design** — `Effort S · Impact delight`
Subtle click/launch/download sounds with a volume slider and automatic mute while the game is running. Must default to off or very quiet.

**F15 · Instance organization** — `Effort M · Impact high`
Pin/favourite, tags, groups/folders, custom colour and cover image, drag-to-reorder, and a compact list view. The installations list is currently sorted only by last played.

**F16 · Splash text and daily tip** — `Effort S · Impact delight`
The classic rotating splash line, plus a dismissible tip ("you can press Ctrl+K"). Cheap personality; both can be disabled.

**F17 · Local milestones** — `Effort M · Impact delight`
Playtime and activity milestones ("first mod installed", "10 hours", "first backup restored") recorded locally with no account or telemetry. Fun, but only after the core trust features.

**F18 · Streamer mode** — `Effort S–M · Impact low–medium`
Hide account names, server addresses, and file paths behind placeholders in the UI and logs, with a quick toggle. Useful for people who stream the launcher.

**F19 · Window placement memory** — `Effort S · Impact medium`
Remember position, size, maximized state, and monitor; clamp back on-screen when a monitor disappears. Slightly more than just width/height.

---

## G. Diagnostics and support

*The log viewer is already better than most launchers. These ideas make failures self-explaining.*

**G1 · Log tail and search upgrades** — `Effort S–M · Impact high`
Follow/tail mode, pause, regex search, log-level filter, "jump to first error", and a minimap of warnings/errors. The current viewer is read/filter/copy/export.

**G2 · Mod attribution for log lines** — `Effort M · Impact high`
Map logger names and stack frames back to mod jars so the viewer can say "this line came from Create" instead of `com.simibubi.create...`. Also enables "show only lines from this mod".

**G3 · Crash analyzer** — `Effort M · Impact high`
Dedicated parser for `hs_err_pid*.log` and `crash-reports/*.txt`: detect OOM, JVM version, driver faults, mixin failures, and the first mod in the stack; offer targeted fixes. Complements A2/A16.

**G4 · Live JVM monitoring** — `Effort L · Impact medium`
Heap, GC, CPU, and thread counts while the game runs, with a thread dump and "kill" button. Requires launching with local JMX or a small agent; treat as experimental until proven stable.

**G5 · Network diagnostics** — `Effort M · Impact medium`
One panel to test Mojang endpoints, DNS, proxy, and download speed; show HTTP status and latency per host; copy a report. This turns "it won't install" into a diagnosis.

**G6 · Download history** — `Effort S–M · Impact medium`
A persistent list of completed/failed files with checksum results, retry, and open-folder. The job drawer is transient today.

**G7 · Self-test wizard** — `Effort M · Impact medium`
Run checks on demand: Java, write access, game directory, GPU/driver info, network, disk space, and permissions. Useful after a Windows update or when moving to a new PC.

**G8 · Issue-report helper** — `Effort S–M · Impact medium`
Pre-fill a GitHub issue with a scrubbed diagnostics bundle (paths, versions, last errors) and let the user review before opening it. No automatic upload.

**G9 · Log bookmarks and excerpts** — `Effort S · Impact low`
Mark lines, add a note, and copy/share a short excerpt. Helpful for modpack support channels.

**G10 · Per-instance performance summary** — `Effort M · Impact medium`
Track install time, launch-to-menu time where the log allows it, crash count, and peak memory, and show trends. Useful for spotting a profile that got slower after an update.

---

## H. Maintenance and storage

*Minecraft data grows quietly. These features make it visible and safe to reclaim.*

**H1 · Disk usage analyzer** — `Effort M · Impact high`
Break down storage by instance, shared versions, libraries, assets, backups, logs, caches, and Bedrock downloads. Sortable bars or a treemap, with "open folder" and "what is this?" explanations.

**H2 · Cleanup wizard** — `Effort M–L · Impact high`
Find unused versions, orphaned libraries/assets, old logs, old backups, temporary Bedrock packages, and stale caches; show reclaimable space and delete only after preview + confirmation. Never touches worlds or mods by default.

**H3 · Verify and repair all** — `Effort M · Impact high`
Batch integrity check across every installation, re-download corrupt files, and report per-instance results. The per-installation verifier already exists; this is mostly orchestration and a results UI.

**H4 · Cache management** — `Effort S · Impact medium`
Show sizes for artwork, version manifests, Modrinth responses, block textures, screenshot thumbnails, and Bedrock catalogues; clear/rebuild individually. Makes H1/H2 precise.

**H5 · Low-disk preflight** — `Effort S · Impact high`
Estimate required space before an install, download, backup, or Bedrock package; refuse with a clear number instead of failing halfway.

**H6 · Move instance data** — `Effort M · Impact medium`
Move a game directory to another drive with progress, validation, and profile update. Today the path can be changed, but moving the actual files is manual.

**H7 · Launcher config export/import** — `Effort S · Impact medium`
Export settings, installations metadata, servers, and themes (never tokens) as one JSON file; import on another PC. A simple migration path that does not require cloud sync.

**H8 · Safe factory reset** — `Effort S · Impact low–medium`
Reset launcher settings/metadata after offering an export, while leaving game files untouched. Useful for support and for testing.

**H9 · Shared-directory detection** — `Effort S · Impact medium`
Warn when two installations point at the same game directory (already logged internally), explain the consequences for mods/configs, and offer to merge or separate them.

**H10 · Global retention policy** — `Effort S · Impact medium`
One place to set how many game logs, launcher logs, backups, and screenshot thumbnails to keep, instead of per-feature limits.

---

## I. Platform, packaging, and integration

*This is how Aqua stops being an app you open and becomes part of the desktop.*

**I1 · Launcher auto-update** — `Effort M–L · Impact high`
Use `electron-updater` with stable/beta channels, a changelog, download progress, and a safe restart. Requires signed artifacts and a release host; electron-builder is already configured, so the main work is release plumbing and signing.

**I2 · Portable mode** — `Effort S–M · Impact medium`
Store everything next to the executable (or under a chosen folder) when `--portable` is passed or a marker file exists. No registry, no AppData; USB-friendly. Requires care with the single-instance lock and tray paths.

**I3 · Import from other launchers** — `Effort L · Impact high`
Detect vanilla `.minecraft`, Prism/MultiMC instances, CurseForge profiles, and ATLauncher instances; offer to adopt versions, mods, saves, and settings as Aqua installations without copying gigabytes when a pointer is enough.

**I4 · Deep links** — `Effort M · Impact medium`
Register `aqua://` for launch, join (`aqua://join?server=host:port`), and install (`aqua://install?pack=…`). Handles the single-instance lock and forwards to the existing IPC actions. Makes "click to join" possible from Discord or a website.

**I5 · CLI** — `Effort M · Impact medium`
`aqua launch <instance>`, `aqua join <address>`, `aqua install <pack>`, `aqua status`, with machine-readable output. Useful for Stream Deck, scripts, and shortcuts; can share the deep-link router.

**I6 · Discord Rich Presence** — `Effort M · Impact delight`
Show the instance, Minecraft version, loader, server (opt-in), and elapsed time, with a Join button where possible. Requires a Discord application ID; add a privacy toggle.

**I7 · Gamepad and Steam Deck navigation** — `Effort L · Impact medium`
Full controller navigation with focus rings, a big-picture layout, and verification on Steam Deck (AppImage/Flatpak). A natural fit for a launcher that already supports Bedrock and Quick Play.

**I8 · Platform hardening** — `Effort L · Impact medium`
Apple Silicon Java detection, ARM64 Windows builds, Linux `.deb`/Flatpak, code signing/notarization, and CI builds for each target. The README currently calls macOS/Linux "included but not actively tested".

**I9 · File associations** — `Effort M · Impact medium`
Register `.mrpack`, `.mcpack`, `.mcaddon`, and `.mcworld` to open with Aqua, plus a Windows "Add to Aqua" context-menu verb. Turns downloads into a one-click flow.

**I10 · Windows jump list** — `Effort S · Impact low–medium`
Recent instances and "join last server" in the taskbar jump list. Cheap once deep links/CLI exist.

**I11 · Startup behavior polish** — `Effort S · Impact medium`
Close-to-tray option, start hidden, auto-close after launch, and a first-run choice between "open window" and "stay in tray". Some of this exists; the missing piece is explicit, discoverable control.

**I12 · Reproducible builds** — `Effort M · Impact low–medium`
CI that runs tests, typecheck, and build on every push, plus provenance for release artifacts. Not user-facing, but it makes releasing more often safe.

---

## J. Bedrock-specific

*Bedrock support is unusually deep already. The gaps are mostly around data safety and the limits of the Store package model.*

**J1 · Bedrock world backup/export** — `Effort M · Impact high`
ZIP a world folder with its metadata and icon; restore as a copy with a new folder ID. This is the most important missing safety feature for Bedrock players.

**J2 · Bedrock world details** — `Effort M · Impact medium`
Parse Bedrock's little-endian `level.dat` to show game mode, difficulty, last played, and seed, and surface the existing `world_icon.jpeg` more prominently. Currently only the name and thumbnail are used.

**J3 · Pack dependency and duplicate checks** — `Effort M · Impact medium`
Read add-on manifests for dependencies, detect duplicate UUIDs/versions, and show which world uses which pack (read-only at first). Editing world pack activation is risky because the game owns those files.

**J4 · Add-on re-import/update** — `Effort S · Impact low–medium`
Keep the source file for imported packs and offer "re-import" when a newer `.mcpack` arrives. Without a catalogue API, a real update check is not possible.

**J5 · Package downloader hardening** — `Effort M · Impact medium`
Resume 1 GB+ downloads, verify checksums where available, preflight disk space, and clean up partial files on cancel. The current flow streams and unpacks; a failed download should not leave a large orphan.

**J6 · MSIXVC guidance** — `Effort S · Impact low`
Explain why MSIXVC builds cannot be registered, open the Microsoft Store page, and copy the package link, instead of only saving the file for reference.

**J7 · Bedrock screenshots** — `Effort S · Impact low–medium`
Include common Bedrock screenshot locations in the gallery, with edition badges so Java and Bedrock shots do not mix confusingly.

**J8 · Unified edition dashboard** — `Effort M · Impact medium`
One recent list and one world list with Java/Bedrock filters, instead of separate sections that repeat the same concepts. Keep the edition switch, but share the components.

**J9 · Bedrock server polish** — `Effort S–M · Impact medium`
Favourites, ping history, join defaults, and per-server edition editing (today the edition is fixed at add time). Reuses the Java server improvements.

**J10 · Backup before registration swap** — `Effort S · Impact high`
When registering a downloaded Bedrock build (which unlists the Store copy), offer to back up worlds first and state exactly what will change. The confirmation exists; adding a backup shortcut makes it safer.

---

## K. Big bets and experimental

*High effort, high upside. These need a product decision before engineering starts.*

**K1 · One-click server hosting** — `Effort XL · Impact high`
Local Paper/Fabric server with console, plugins, backups, and optional UPnP port mapping + a shareable address. The launcher already provisions Java and can download server jars. Security, support burden, and router compatibility are the real costs.

**K2 · Server pack sync** — `Effort XL · Impact high`
Read a server's packwiz/server-pack manifest and install exactly the required client mods before joining, with drift detection on later joins. This is the "it just works" feature for modded multiplayer.

**K3 · World map renderer** — `Effort XL · Impact delight`
Anvil region parsing, chunk decoding, texture atlas sampling, and a canvas renderer with zoom/pan. Very cool, very expensive, and easy to underestimate.

**K4 · Modpack authoring** — `Effort L–XL · Impact medium`
Create a pack from an instance, add/remove mods, edit overrides, export `.mrpack`, and optionally publish to Modrinth with a personal access token. Targets the small but passionate creator segment.

**K5 · Bring-your-own cloud sync** — `Effort L · Impact medium`
Sync settings, installation metadata, server list, themes, and mod lists through a user-provided WebDAV/S3 folder. Worlds and tokens stay local by default. No launcher account, no hosted backend.

**K6 · AI crash explainer (optional, BYO key)** — `Effort M · Impact medium`
After the local rules in A16 fail, optionally send a redacted log excerpt to a provider the user configures. Must be off by default, clearly explained, and never include tokens, paths, or server addresses. Only worth doing if the local knowledge base proves insufficient.

**K7 · Starter templates** — `Effort M · Impact medium`
Curated one-click setups ("Vanilla+ performance", "Create tech", "Better vanilla") distributed as `.mrpack` or a small static manifest. Pairs with B15 and B8.

**K8 · Launch-time benchmarking** — `Effort M · Impact low–medium`
Record install time, launch-to-menu time, and crash rate per instance/version, then show whether a change made things better or worse. FPS needs a game mod, so keep the scope to launcher-observable timing.

---

## What I would deliberately not build

These are not missing features; they are scope traps or policy risks.

- **Bundling Minecraft assets, client jars, or mods outside official downloads.** Legal and trust risk; the current downloader respects this.
- **Auth bypass or offline-mode access to online servers.** Offline profiles are fine; pretending they can join online-mode servers is not.
- **A built-in social network or chat.** Requires moderation, accounts, and a backend that this project does not have.
- **Default-on telemetry or analytics.** Optional, explicit, and scrubbed diagnostics only.
- **Ads, crypto, or an account marketplace.** Wrong product, wrong incentives.
- **A stack rewrite (Tauri, web-only, etc.).** The Electron architecture is doing real work here: credential storage, Bedrock package registration, child-process management, and webviews.
- **Auto-updating the game or mods without consent.** A policy with a clear off switch is the right shape.
- **Redistributing CurseForge packs without checking their API terms.** Import-by-file is safer unless the terms are reviewed.

---

## Dependencies and "cheap because the plumbing exists"

| Idea | Existing foundation |
|------|---------------------|
| A1 Safe Mode | Installation directory management + disabled-file handling in Modrinth service |
| A2/A16 Crash Guard | Game process tracking, crash-report capture, launcher log service |
| A4 Health check | `getInstallationState`, Java probe, world counter, path validators |
| A13 Download queue | `JobManager`, bounded-concurrency downloader, bandwidth limits |
| B4 Jar inspector | ZIP reading (`adm-zip`) and Modrinth's existing jar metadata logic |
| B7 Local pack import | `.mrpack` parsing and override copying already implemented for installs |
| B12 Datapacks | Same download/hash pipeline as resource packs; only a new content type |
| C7 LAN discovery | Existing server ping + Quick Play metadata |
| C8 Per-server instance | Server entries already store edition; launch path already accepts an address |
| D1 Scheduled backups | Existing ZIP backup writer + game-exit hooks |
| D4 World editor | Existing NBT parser and `level.dat` reader |
| D9 Bedrock backup | Existing Bedrock data-root resolution + `adm-zip` |
| F4 Screenshot gallery | Known game directory + `nativeImage` thumbnails |
| H3 Verify all | Per-installation verifier already returns state |
| I1 Auto-update | `electron-builder` is already configured for NSIS/DMG/AppImage |
| I3 Import launchers | Installation creation accepts an existing `gameDir` |
| I4/I5 Deep links/CLI | Single-instance lock already exists and can forward argv |
| I6 Discord RPC | Game state already exposes instance, version, and server |
| J1 Bedrock backup | Bedrock world listing resolves the exact folders |

---

## Suggested release phases

These are sequenced by dependency and user trust, not by how fun they are to build.

**Phase 1 — Trust (make the launcher dependable)**
I1 auto-update · A2/A16 Crash Guard · A1 Safe Mode · A4 health check · D1 scheduled backups · H1/H2 disk cleanup · J1 Bedrock backups · G3 crash analyzer.

**Phase 2 — Content depth (make modding legible)**
B1 mod detail · B2 filters · B4 jar inspector · B5 conflict checker · B6 drag-and-drop · B7 local pack import · B8 pack export · B12 datapacks · B13 pack ordering · F4 screenshots.

**Phase 3 — Servers and reach (make it part of the desktop)**
C1/C2/C3 local server manager · C7 LAN discovery · C8 per-server instance · C10 list polish · C12 compatibility warnings · I4 deep links · I5 CLI · I6 Discord RPC · F1/F2 command palette and search.

**Phase 4 — Platform (make it grow)**
F12 localization · I3 launcher import · I2 portable mode · I7 gamepad/Steam Deck · I8 platform hardening · F11 accessibility · K2 server pack sync · K5 BYO cloud sync.

---

## Open questions for you

1. **Priority:** Windows-first, or invest in macOS/Linux/Steam Deck parity next?
2. **Online services:** are auto-update hosting and Discord RPC acceptable, or should everything stay local?
3. **Content sources:** is Modrinth enough, or do you want CurseForge/FTB badly enough to handle API keys and terms?
4. **Launching:** should Aqua stay a launcher, or become a launcher + local server manager (K1/C1)?
5. **Localization:** which languages matter first? That changes whether F12 is an XL framework project or a smaller targeted effort.
6. **Telemetry stance:** confirm "none by default", or allow opt-in crash reports (G8)?

Reply with the IDs you want and I can turn the chosen set into a scoped implementation plan, ordered by dependency.
