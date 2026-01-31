# Changelog

## v0.1.3

### Added
- **Help System** - Info (i) buttons throughout the app with contextual help popovers for each panel
- **Patch History on Startup** - All existing patches are now loaded into history when the app starts
- **Delete Patch Warning** - Warning message near delete button about game restart requirement

### Fixed
- **Teleport** - Fixed player teleport using proper `Teleport.createForPlayer()` API
- **Surname Field** - Fixed capitalization mismatch between backend and GUI

### Changed
- **UI Layout** - Consistent button alignment across all panel headers (buttons grouped on right, info button rightmost)
- **Default Settings** - Header minimized, packet log and live changes panels hidden by default on first start
- **Info Button Style** - Clean serif italic "i" instead of pixelated Unicode character

---

## v0.1.2

### Added
- Asset refresh capability with smart timing
- Hytalor integration note in README

### Changed
- Simplified installation instructions
- Updated READMEs with full documentation

---

## v0.1.1

### Added
- Persist UI settings across page refresh (tab, filters, pause states, sort modes)

### Fixed
- Cache auto-clears on disconnect to prevent stale data
- Fixed manifest.json version (was stuck at 0.0.3)

---

## v0.1.0

### Added
- Cross-platform auto-updater scripts (`update.ps1` / `update.sh`)
- Version sync and automatic update checking
- GitHub Actions release workflow

---

## Pre-release (0.0.x)

### Added
- **Entity Inspector** - Real-time entity tracking, component inspection, deep expansion
- **Asset Browser** - Browse/search game assets with Hytalor patch integration
- **Alarms Panel** - Entity alarm tracking with live countdown using game time sync
- **Packet Log** - Network packet capture and inspection
- **Themes** - Terminal, Standard, and Light themes
- Resizable panels, per-panel pause controls
- Global change monitor for live component updates

### Fixed
- XSS vulnerability in GUI
- TransformComponent live updates
- Various security and memory fixes
