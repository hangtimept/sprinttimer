# Sprint Timer Pro

**Professional dual-phone sprint timing system** — precise start/finish line detection using two smartphones, PeerJS pairing, adaptive motion detection, and automatic speed calculation.

Runs entirely in the browser. No app install required.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### Timing
- Dual-phone **Start** and **Finish** cameras linked over the internet (PeerJS)
- Adaptive motion detection across an adjustable vertical detection line
- Automatic clock synchronization between devices
- Live running timer + final time to **0.001 s**
- Optional **distance input** → average speed (m/s, km/h, mph)
- Session history with best time highlighting
- Arm / Reset with warmup period to avoid false triggers

### Detection quality
- Frame-difference motion along a configurable band
- Adjustable sensitivity + live calibration meter
- Multi-frame confirmation (reduces false positives)
- Warm-up frames after arming
- Detection line can be dragged left/right
- Visual feedback when motion is detected

### UX
- High-contrast outdoor-friendly dark UI
- Large timer digits readable in sunlight
- Role-based pairing with 5-digit room code
- Connection status & latency indicator
- Sound + vibration on start/finish (when supported)
- Screen Wake Lock to keep the display on
- Optimized for Safari on iPhone and Chrome on Android

## How to use

1. Open the same page on **two phones** (Safari on iPhone recommended).
2. One phone: **I am START Camera** → share the 5-digit code.
3. Other phone: **I am FINISH Camera** → enter the code → Connect.
4. On each phone: tap **Enable Camera** and allow access.
5. Point cameras at the start line and finish line (vertical cyan line = detection plane).
6. Optionally enter the distance between the two lines.
7. Tap **Arm / Reset** on either phone.
8. Athlete runs through start → finish. Time and speed appear automatically.

## Tips for best accuracy

- Mount phones securely (tripod or stand) so they don’t move.
- Detection line should be perpendicular to the running direction.
- Good, even lighting helps; avoid strong shadows crossing the line.
- Use **Calibration** mode to watch the motion meter while someone walks through the line, then set sensitivity just above the noise floor.
- Keep the athlete’s body (not just arms) crossing the line for cleaner triggers.

## Browser support

- **iPhone**: Safari (required for reliable camera + PeerJS)
- **Android**: Chrome
- Requires camera permission and a network connection (PeerJS uses public servers by default)

## Privacy

Video never leaves the device. Only small timing messages are exchanged between the two phones via PeerJS.

## License

MIT
