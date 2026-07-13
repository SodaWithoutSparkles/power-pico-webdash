# Phase 5: Unified Detector + UI Consolidation

Implements Steps 5+9 from `pending-issues.md` (§8 Unified detector, §9 UI consolidation).

## Summary

### Unified detector
Single detector subsystem for threshold crossing and peak detection. Config per channel (V/A): threshold, hysteresis, debounce, direction, enable. Real-time processing in engine ingest pipeline. Events drawn as markers on graph. Events list in popup panel with CSV export. Optional audio alert (Web Audio, unlocked on connect/start).

### UI consolidation
Range operations dropdown (⋯ button) groups export, detector, calibration, clear. Simulate button removed. Clear moved to left toolbar. Top bar already shows pkt/s.

## Files Changed/Created

### 1. `src/scope/engineTypes.ts`
- Added `DetectorDirection`, `DetectorChannelConfig`, `DetectorConfig`, `DetectorEvent` types.

### 2. `src/scope/Detector.ts` (new)
- `Detector` class: per-channel state machine with threshold-crossing detection.
- Hysteresis re-arm: value must drop below `threshold - hysteresis` before re-firing.
- Debounce: minimum time between events per channel.
- Direction: positive, negative, or both.
- Events bounded at 10,000 max. Exports `DEFAULT_DETECTOR_CONFIG`.

### 3. `src/scope/ScopeEngine.ts`
- Integrated `Detector` instance. `detector.process('v'|'i', displayT, value)` called in `ingest()`.
- Public methods: `setDetectorConfig`, `getDetectorEvents`, `clearDetectorEvents`, `resetDetector`.
- `clear()` also clears/resets detector.
- `onDetectorEvent(cb)` callback for audio alert.

### 4. `src/store/scopeStore.ts`
- Added `detectorEvents`, `detectorVConfig`, `detectorIConfig` state.
- Actions: `setDetectorConfig`, `getDetectorEvents`, `clearDetectorEvents`, `syncDetectorEvents`.
- Registered `engine.onDetectorEvent()`: plays beep + syncs events to store.
- `unlockAudio()` called on `connect` and `start` (user gesture).

### 5. `src/scope/PopupPanel.tsx` (new)
- Reusable modal shell: fixed 75vw × 90vh, backdrop dismiss, Escape-to-close, title bar with icon.

### 6. `src/scope/DetectorPanel.tsx` (new)
- Detector popup with Config/Events tabs.
- Config: per-channel threshold/hysteresis/debounce/direction controls.
- Events: polled every 500ms, newest-first list, Export CSV button, Clear button.

### 7. `src/scope/useScopeEngine.ts`
- `detectorMarkersPlugin()`: draws dashed vertical lines + dots at detector event positions on graph. Reads events from `engine.getDetectorEvents()`.

### 8. `src/scope/audioAlert.ts` (new)
- `unlockAudio()`: creates/resumes Web Audio context.
- `playDetectorBeep(channel)`: 150ms square-wave beep (V=880Hz, I=440Hz).

### 9. `src/scope/ScopeView.tsx`
- Replaced standalone Detector button with Range operations (⋯) dropdown: Export CSV, Detector, Calibration, Clear.
- DetectorPanel rendered when `detectorOpen` state true.

### 10. `src/scope/ScopeHeader.tsx`
- Removed Simulate button and `simulate` import.
- Removed Clear button (moved to toolbar).

### 11. `src/scope/ScopeToolbar.tsx`
- Added Clear button (Trash2) to left toolbar.

## Acceptance Criteria

1. `tsc --noEmit` clean.
2. 23/23 tests pass.
3. Detector config editable, events listed in panel.
4. Detector events drawn as markers on graph.
5. Audio beep on detection (after connect/start).
6. Range operations dropdown works.
7. Simulate button gone, Clear on left toolbar.

## Implementation Status

- **Build**: `tsc --noEmit` clean, `vite build` passes
- **Tests**: 23/23 pass
