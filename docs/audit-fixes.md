# Audit repair checklist

Source audit: main at `4bc662b`, 2026-09-20. Hardware-dependent checks are listed separately; no deployment or merge is included in this PR.

| ID | Finding | Status / validation |
|---|---|---|
| 01 | Malformed tutor context terminates the API process | Fixed — bounded nested validation, Express async error forwarding; real API survival tests. |
| 02 | The camera reverses textbook text before extraction | Fixed — raw scans remain unmirrored, hand preview is mirrored; asymmetric image regression. |
| 03 | A camera failure can leave a permanently active ghost hand | Fixed — frame age limits, explicit hand loss, tracker/camera restart, source timestamp deduplication and camera-loss preview; Python + input tests. |
| 04 | Low-confidence extraction loads before the user can confirm it | Fixed — reviewed draft with Confirm/Keep buttons; browser verified current scene stays intact. |
| 05 | Incomplete problems receive invented values without a repair notice | Fixed — essential givens rejected when missing; conventional defaults are recorded and confirmed; table-driven cases across all nine types. |
| 06 | Accepted speeds are silently changed by the simulation | Fixed — shared input/energy limits and orbit-frequency checks; emergency speed changes produce a visible warning; boundary tests. |
| 07 | Timeline and undo do not restore angular velocity correctly | Fixed — Matter base-delta conversion and sandbox spin serialization/restoration; both-world round trips. |
| 08 | Grabbing a pendulum does not update its integrated angle | Fixed — project grabs onto the pendulum arc, resync angle/rate, clear held velocity; both-world regressions. |
| 09 | Decorative origin markers collide with particles | Fixed — origin/pivot decorations are sensors; no-deflection regressions. |
| 10 | Displayed energy and angular momentum omit spin | Fixed — rotational kinetic energy and spin angular momentum, with shape-specific rolling inertia; energy tests. |
| 11 | Conservation diagnostics promise laws that do not apply | Fixed — gravity/anchor torques, inelastic bob contacts, vector momentum drift; invariant tests. |
| 12 | Incline solutions mishandle static and uphill cases | Fixed — static acceleration is zero, unreachable bottom is explicit; unsupported uphill launches are rejected before load. |
| 13 | A rolling cylinder or hoop on an incline is treated as a solid sphere | Fixed — shape inertia controls acceleration, spin energy and friction; sphere/disc/hoop trajectory tests. |
| 14 | Downward projectiles receive an apex above their starting point | Fixed — forward-time apex uses positive vertical launch velocity only; downward-launch regression. |
| 15 | Large pendulum amplitudes keep a small-angle period answer | Fixed — amplitude-dependent elliptic-integral period; measured 90° swing agrees. |
| 16 | Zero-speed rolling renders an invalid fraction as infinity | Fixed — limiting shape ratio at rest, explicit caveat, separate NaN display; zero-speed regression. |
| 17 | Force diagrams can contradict the modeled acceleration | Fixed — contact-aware arrows, rolling static friction and ground reactions; acceleration/airborne tests. |
| 18 | Generated-text consistency accepts contradictory problems | Fixed — generated statements rendered from validated quantities; contradictory model prose cannot override them; real API test. |
| 19 | Late scan/generation responses overwrite newer work, and scans bypass undo | Fixed — request cancellation/versioning, guarded scan downloads, snapshot before import/mode switch; unit and browser race/undo checks. |
| 20 | Edited givens disagree with the problem statement and tutor context | Fixed — original text labeled separately from current givens; tutor receives overrides; browser and API checks. |
| 21 | Single-step after seeking does not branch the timeline | Fixed — single-step commits the scrub cursor and force-records its frame; unit + browser branch checks. |
| 22 | Some destructive sandbox edits are missing from undo | Fixed — ground and initial velocity edits snapshot first; browser ground-toggle undo verified. |
| 23 | Mouse release leaves the mock hand closed and moving | Fixed — immediate button state, velocity expiry, blur/leave/stop cleanup; input regressions. |
| 24 | The legacy camera fallback no longer supplies the required push gesture | Fixed — legacy bridge supplies fist score and suppresses false pinch; Python regression and HTTP mapping. |
| 25 | Hand acquisition survives world replacement, and paused behavior differs by mode | Fixed — coupling reset across load/reset/restore/modes; paused sandbox no longer runs hand coupling; reset regression. |
| 26 | Overlapping microphone startup leaks an active recording | Fixed — single owned session includes permission startup, late-grant cleanup and failure cleanup; overlapping/start-failure regressions. |
| 27 | Requests lack deadlines and can leave controls permanently busy | Fixed — deadlines include response bodies; hand polls abort on stop, panel state replays on reconnect; stalled-body regression. |
| 28 | Invalid voice credentials are reported as ready | Fixed — documented credential probe, distinct invalid-key/unavailable states and updated UI; status mapping tests. |
| 29 | Concurrent scan saves overwrite one file and count two successes | Fixed — save claim, unique capture ID, atomic file publication, retry-safe failure and recapture preservation; concurrent HTTP tests. |
| 30 | Shutdown trusts any HTTP origin, even with the default loopback bind | Fixed — trusted Host/Origin checks, exact CORS origins and per-session shutdown token; adversarial HTTP tests. |
| 31 | Local inference services are exposed beyond the kiosk without access controls | Fixed in provisioning — API/Ollama/MQTT default to loopback; SSH and restricted ESP32 access documented. Existing GX10 configuration must be migrated when deploying. |
| 32 | The panel body parser permits malformed types and unbounded reads | Fixed — bounded object-only JSON, finite numbers, read deadline, invalid length/type/encoding errors; HTTP regressions. |
| 33 | The toolbar hides important controls in narrower windows | Fixed — wrapping toolbar and stacked mobile layout; browser verified 1280, 1024×600 and 390×844, no horizontal overflow. |
| 34 | The standalone panel setup path fails on a fresh checkout | Fixed — shared virtual environment and model directory created before symlink/download; shell syntax and path review. |
| 35 | Re-running the installer does not install changed dependencies | Fixed — installer always reconciles npm lockfile and Python requirements, checks Node minimum; provisioning review. |
| 36 | Launcher health checks accept broken services as healthy | Fixed — identity-aware HTTP checks and separate model readiness; fake HTTP/API inventory regressions. |
| 37 | A failed ring-light update is never retried in the same view | Fixed — retry newest desired light state, periodic retained refresh and off on shutdown; broker failure/recovery test. |
| 38 | Stop Demo can terminate unrelated development processes | Fixed — private process group plus PID/start-time/boot-ID ownership; no wildcard kills; stale/reused-PID tests. |
| 39 | The locked development toolchain has known advisories | Fixed — Vite 7.3.6 and matching Express types; production build passes and npm audit reports zero vulnerabilities. |
| 40 | Existing green checks omit the failure paths found in this audit | Fixed — one aggregate gate and CI cover build, physics, rope, audit, input, API, Python panel/recovery and launcher checks; E2E mismatch sets failure exit status. |

## Validation

`npm run verify:all` runs TypeScript/production build, both original physics suites,
19 rope checks, 14 audit regression groups (including per-type completeness cases),
input/recording tests, a real API against an isolated fake model, the original panel
flow, 5 rope-panel tests, 10 recovery/security tests and 2 launcher test groups.
`npm audit --audit-level=moderate` reports zero vulnerabilities.

Browser checks used a temporary, camera-free local fixture API: draft confirmation,
import undo, delayed-generation cancellation, ground-toggle undo, single-step after
scrubbing, edited tutor givens and responsive layouts. No browser console errors.
No paid model requests, real recordings, shutdowns, firmware changes or deployments.

## Hardware rehearsal

After merging and provisioning: verify printed scan orientation, camera unplug/replug, actual voice permissions/transcription, touchscreen layout, model readiness and ring-light reconnect on the GX10.


Before reprovisioning the GX10, configure authenticated MQTT or a firewall-restricted
listener for the ESP32; the secure loopback default deliberately does not accept
anonymous LAN clients. Use Node 20.19+ or 22.12+ and rerun the installer. Readiness
checks inventory and reachability; an actual extraction/transcription and camera/light
unplug-replug rehearsal is still required on the physical rig.
