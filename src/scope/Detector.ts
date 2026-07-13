import type { DetectorChannelConfig, DetectorEvent } from "./engineTypes";

export const DEFAULT_DETECTOR_CONFIG: { v: DetectorChannelConfig; i: DetectorChannelConfig } = {
    v: { enabled: false, threshold: 5.0, hysteresis: 0.1, debounceMs: 100, direction: 'positive' },
    i: { enabled: false, threshold: 0.5, hysteresis: 0.01, debounceMs: 100, direction: 'positive' },
};

// Internal state per channel
interface ChannelState {
    armed: boolean;              // ready to fire
    lastEventTimeUs: number;     // display-time of last event
}

export class Detector {
    private vConfig: DetectorChannelConfig = { ...DEFAULT_DETECTOR_CONFIG.v };
    private iConfig: DetectorChannelConfig = { ...DEFAULT_DETECTOR_CONFIG.i };
    private vState: ChannelState = { armed: true, lastEventTimeUs: -Infinity };
    private iState: ChannelState = { armed: true, lastEventTimeUs: -Infinity };
    private nextId = 1;
    private events: DetectorEvent[] = [];

    setConfig(channel: 'v' | 'i', config: Partial<DetectorChannelConfig>): void {
        if (channel === 'v') Object.assign(this.vConfig, config);
        else Object.assign(this.iConfig, config);
        // Reset armed state on config change
        if (channel === 'v') this.vState.armed = true;
        else this.iState.armed = true;
    }

    getConfig(channel: 'v' | 'i'): DetectorChannelConfig {
        return channel === 'v' ? { ...this.vConfig } : { ...this.iConfig };
    }

    // Process one data point per channel. Called from engine ingest().
    // tUs = display-time (T+0 adjusted), value = zeroed value in base units.
    process(channel: 'v' | 'i', tUs: number, value: number): DetectorEvent | null {
        const config = channel === 'v' ? this.vConfig : this.iConfig;
        const state = channel === 'v' ? this.vState : this.iState;

        if (!config.enabled) return null;

        // Debounce check
        const dtMs = (tUs - state.lastEventTimeUs) / 1000;
        if (dtMs < config.debounceMs && state.lastEventTimeUs > 0) return null;

        const { threshold, hysteresis, direction } = config;
        const rearmLevel = threshold - hysteresis;

        let crossing: 'rising' | 'falling' | null = null;

        // Rising: value crosses ABOVE threshold from below rearm level
        if ((direction === 'positive' || direction === 'both') && state.armed && value >= threshold) {
            crossing = 'rising';
        }
        // Falling: value crosses BELOW -threshold (for bidirectional) or below threshold for negative direction
        if ((direction === 'negative' || direction === 'both') && state.armed && value <= -threshold) {
            crossing = 'falling';
        }

        // Re-arm logic: value drops below rearm level
        if (!state.armed && value < rearmLevel) {
            state.armed = true;
        }
        // Re-arm for negative direction
        if (!state.armed && direction !== 'positive' && value > -rearmLevel) {
            state.armed = true;
        }

        if (crossing) {
            state.armed = false;
            state.lastEventTimeUs = tUs;
            const event: DetectorEvent = {
                id: this.nextId++,
                channel,
                timestampUs: tUs,
                value,
                direction: crossing,
                threshold,
            };
            this.events.push(event);
            // Keep event list bounded (max 10000 events)
            if (this.events.length > 10000) {
                this.events.splice(0, this.events.length - 10000);
            }
            return event;
        }

        return null;
    }

    getEvents(): DetectorEvent[] {
        return this.events;
    }

    clearEvents(): void {
        this.events = [];
    }

    reset(channel?: 'v' | 'i'): void {
        if (!channel || channel === 'v') this.vState = { armed: true, lastEventTimeUs: -Infinity };
        if (!channel || channel === 'i') this.iState = { armed: true, lastEventTimeUs: -Infinity };
    }
}
