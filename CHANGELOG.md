# Changelog

## v0.2.6

**Release Date:** 2026-06-10

### Fixed
- Fixed Static scene accessories not applying the selected scene.
- Updated Static scene activation to match Monster app behavior by setting `pause`, `mode`, `st_pat`, and the matching `stXX` scene payload.

## v0.2.5

**Release Date:** 2026-06-10

### Added
- Added per-scene visibility controls in the Homebridge custom UI.
- Added automatic discovery and caching of scene metadata for UI management.
- Added visible/hidden scene organization for Static, Dynamic, DIY, Music, and Custom scenes.

### Changed
- Hidden scenes are now excluded from HomeKit accessory creation.
- Hidden scene accessories are automatically removed from Homebridge cache and HomeKit.

### Fixed
- Prevented hidden scene accessories from reappearing after plugin restart.

## v0.2.4

**Release Date:** 2026-06-10

### Added
- Added optional HomeKit switches for Monster Static scenes.
- Added optional HomeKit switches for Monster Custom RGBIC scenes.
- Added Custom scene discovery and activation support.
- Added RGBIC preset state tracking through per_ic/per_ic_pat.

### Changed
- Extended active scene detection to support all Monster scene families:
  - Static
  - Dynamic
  - DIY
  - Music
  - Custom RGBIC

### Notes
- Scene creation and editing remain managed through the Monster Smart Lighting application.
- Homebridge now supports discovery and activation of all currently known Monster scene categories.

## v0.2.3

**Release Date:** 2026-06-10

### Added
- Added optional HomeKit switches for Monster Music scenes.
- Music scenes are automatically discovered from compatible Monster devices when enabled in plugin settings.

### Changed
- Extended the existing scene accessory framework to support Music scene activation and state reporting.

## v0.2.2

**Release Date:** 2026-06-10

### Added
- Added optional HomeKit switches for Monster Dynamic scenes.
- Dynamic scenes are automatically discovered from compatible Monster devices.

### Changed
- Expanded scene category configuration to include future Static, Custom, and Music scene support.
- Improved scene accessory state tracking for non-DIY scene families.

## v0.2.1

**Release Date:** 2026-06-09

### Added

- Added compatibility fallback profile for future authentication changes

### Changed

- Replaced hard-coded iPhone client identity with a Homebridge-specific authentication profile
- Reduced dependency on Monster mobile app metadata during cloud authentication

## v0.2.0

**Release Date:** 2026-06-09

### Added

- DIY scene discovery and activation support
- HomeKit switch accessories for DIY scenes
- Active scene state detection via Ayla properties
- Scene category configuration framework
- Scene accessory state synchronization

### Changed

- Main light accessory now exits active scene mode when manually controlled
- Scene accessory state refreshes when scenes are activated or deactivated

### Known Limitations

- Some discovered scenes may not be compatible with all Monster devices
- Static, Dynamic, Music, and Custom scene categories are not yet implemented


## v0.1.3

**Release Date:** 2026-06-08

### Added

- Added internal preset discovery framework for Monster lighting devices.
- Added support for enumerating Static, Dynamic, DIY, Music, and RGBIC presets.
- Added preset parsing models for scene metadata, colors, speed, and music sensitivity.
- Added generic preset activation helpers for all supported preset families.
- Added RGBIC preset retrieval and activation APIs.

### Changed

- Refactored RGBIC preset activation to use shared activation logic.
- Consolidated preset handling into a unified API foundation for future scene and RGBIC features.

### Notes

- This release focuses on internal infrastructure and reverse-engineering progress.
- No new HomeKit controls are exposed in this release.
- Lays groundwork for future RGBIC segment control, scene selection, DIY modes, and music-reactive effects.

## v0.1.2 - Config/UI Polish

**Release Date:** 2026-06-03

### Added

- Added custom Homebridge UI framework for plugin configuration.
- Added masked password input for Monster account credentials.

### Changed

- Improved `config.schema.json` labels and descriptions.

## v0.1.1 - Polish Pass

**Release Date:** 2026-06-03

### Changed

* Tweaked polling behavior and defaults to reduce routine log chatter.
* Promoted key accessory state changes from debug to info logging so standard users can see when devices change state.
* Added the initial framework for future RGBIC capability support.

### Fixed

* Fixed duplicate color writes when HomeKit sends Hue and Saturation updates separately for a single color change.

## v0.1.0 - Initial MVP Release

**Release Date:** 2026-06-02

### Added

* Monster Smart Lighting cloud authentication
* Sphere authentication exchange
* Ayla credential acquisition
* Automatic device discovery
* Homebridge accessory creation and caching
* On/Off control
* Brightness control
* Hue control
* Saturation control
* Color temperature control
* HomeKit state synchronization
* Firmware revision reporting

### Known Limitations

* Authentication tokens are not automatically refreshed
* RGBIC segment control is not yet supported
* Dynamic scenes are not yet supported
* DIY modes are not yet supported
* Music modes are not yet supported
