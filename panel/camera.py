"""Camera + MediaPipe worker for the 7 in. control panel.

One process on the GX10 owns the webcam. That is not a style choice: V4L2 hands
/dev/video0 to a single opener, so if the browser took it with getUserMedia the
panel could not run MediaPipe, and if two Python processes both opened it one
would get an empty frame forever. Everything that needs the camera therefore
goes through this module, and the rest of the system reads it over localhost
HTTP (see panel_server.py).

The capture thread runs flat out; landmark detection runs only while something
is actually watching the hand view, because a 27B model and a hand tracker on
the same box is the one combination that makes the demo drop frames.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

try:  # MediaPipe is optional: scan and shutdown must work without it.
    import mediapipe as mp

    HAVE_MEDIAPIPE = True
    MEDIAPIPE_ERROR = ""
except Exception as exc:  # pragma: no cover - depends on the host wheels
    mp = None  # type: ignore[assignment]
    HAVE_MEDIAPIPE = False
    MEDIAPIPE_ERROR = str(exc)


MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/latest/hand_landmarker.task"
)

# Landmark indices (MediaPipe's 21-point ordering).
WRIST = 0
THUMB_TIP = 4
INDEX_MCP = 5
INDEX_TIP = 8
MIDDLE_MCP = 9
RING_MCP = 13
PINKY_MCP = 17
PALM_LANDMARKS = (WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP)

# Skeleton, not the avatar from hand_physics_demo.py. The panel's job is to tell
# you at a glance whether tracking is healthy, and a skeleton shows a bad
# landmark immediately where a smooth avatar hides it.
CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
)

BONE_COLOR = (170, 214, 122)      # BGR, reads as green on the small panel
JOINT_COLOR = (255, 232, 140)
PINCH_COLOR = (90, 200, 255)

# Thumb-tip to index-tip distance as a fraction of palm width: fully pinched
# and fully open. See _track() for how these become the 0..1 pinch value.
PINCH_CLOSED = float(os.environ.get("PANEL_PINCH_CLOSED", "0.2"))
PINCH_OPEN = float(os.environ.get("PANEL_PINCH_OPEN", "0.8"))


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def find_model(explicit: Optional[str] = None) -> Optional[Path]:
    """Locate hand_landmarker.task.

    Checks the panel's own models/ dir first, then the repo root, so a box that
    already ran hand_physics_demo.py does not download the model twice.
    """
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    here = Path(__file__).resolve().parent
    candidates += [
        here / "models" / "hand_landmarker.task",
        here.parent / "hand_landmarker.task",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


@dataclass
class HandReading:
    """One tracked hand, in the shape src/hand/types.ts expects.

    Coordinates are the SIM's frame, not the camera's: +x right, +y UP, origin
    at the centre of the plane, SI metres. Doing the conversion here means the
    TypeScript side never has to know a camera exists.
    """

    t_ms: float
    handedness: str
    confidence: float
    palm_m: tuple[float, float, float]
    palm_velocity_ms: tuple[float, float, float]
    pinch: float
    landmarks_m: list[tuple[float, float, float]] = field(default_factory=list)
    # The same points as fractions of the (mirrored) camera frame, 0..1, image
    # y down. The metre frame above assumes a fixed width for the whole camera
    # view (PANEL_SCENE_WIDTH_M), which cannot match a sim that zooms to fit
    # each problem; the app maps these onto whatever it is currently showing,
    # so the full camera frame is always the full canvas.
    palm_n: tuple[float, float] = (0.5, 0.5)
    landmarks_n: list[tuple[float, float]] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "t_ms": self.t_ms,
            "handedness": self.handedness,
            "confidence": self.confidence,
            "palm_m": {"x": self.palm_m[0], "y": self.palm_m[1], "z": self.palm_m[2]},
            "palm_velocity_ms": {
                "x": self.palm_velocity_ms[0],
                "y": self.palm_velocity_ms[1],
                "z": self.palm_velocity_ms[2],
            },
            "pinch": self.pinch,
            "landmarks_m": [{"x": p[0], "y": p[1], "z": p[2]} for p in self.landmarks_m],
            "palm_n": {"x": self.palm_n[0], "y": self.palm_n[1]},
            "landmarks_n": [{"x": p[0], "y": p[1]} for p in self.landmarks_n],
        }


def depth_at_palm_mm(_palm_px: np.ndarray) -> Optional[float]:
    """Hook for the VL53L7CX time-of-flight sensor.

    Same honest hook as hand_physics_demo.py: until the 8x8 ToF grid is mapped
    to camera pixels, return None and let the caller fall back to the hand-size
    estimate, which is a guess and is labelled as one in the payload.
    """
    return None


class CameraWorker:
    """Owns the capture device; optionally runs hand tracking on top of it."""

    def __init__(
        self,
        index: int = 0,
        width: int = 1280,
        height: int = 720,
        scene_width_m: float = 1.6,
        model_path: Optional[str] = None,
    ) -> None:
        self.index = index
        self.request_size = (width, height)
        self.scene_width_m = scene_width_m
        self.model_path = find_model(model_path)

        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None       # latest raw (mirrored) frame
        self._overlay: Optional[np.ndarray] = None     # latest frame with skeleton
        self._reading: Optional[HandReading] = None
        self._frame_seq = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

        self._tracking_wanted = False
        self._tracking_active = False
        self._camera_ok = False
        self._error = ""
        self._fps = 0.0
        self._last_palm_px: Optional[np.ndarray] = None
        self._last_palm_t = 0.0
        self._pinch_latched = False
        self._pinch_ratio = 0.0

    # --- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None

    def set_tracking(self, wanted: bool) -> None:
        """Turn landmark detection on or off without touching the capture loop."""
        self._tracking_wanted = wanted

    # --- reads -------------------------------------------------------------

    def status(self) -> dict:
        return {
            "camera_ok": self._camera_ok,
            "error": self._error,
            "fps": round(self._fps, 1),
            "tracking_active": self._tracking_active,
            "hand_visible": self._reading is not None,
            "mediapipe": HAVE_MEDIAPIPE,
            "mediapipe_error": MEDIAPIPE_ERROR,
            "model": str(self.model_path) if self.model_path else None,
        }

    def latest_reading(self) -> Optional[dict]:
        with self._lock:
            return self._reading.as_dict() if self._reading else None

    def snapshot(self, overlay: bool = False) -> Optional[np.ndarray]:
        """A private copy of the newest frame, safe to hand to another thread."""
        with self._lock:
            src = self._overlay if (overlay and self._overlay is not None) else self._frame
            return None if src is None else src.copy()

    def frame_seq(self) -> int:
        return self._frame_seq

    # --- the loop ----------------------------------------------------------

    def _open(self) -> Optional[cv2.VideoCapture]:
        cap = cv2.VideoCapture(self.index)
        if not cap.isOpened():
            self._camera_ok = False
            self._error = f"could not open camera index {self.index}"
            return None
        # MJPEG first, then size, then rate — V4L2 negotiates in that order.
        # OpenCV's default is raw YUYV, and a USB 2 webcam cannot move
        # 1280x720 YUYV faster than ~10 fps; the same camera does 30 fps in
        # MJPEG. The C270 tops out at 30 either way; there is no 60 fps mode.
        fourcc = os.environ.get("PANEL_CAMERA_FOURCC", "MJPG")
        if fourcc:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc[:4]))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.request_size[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.request_size[1])
        cap.set(cv2.CAP_PROP_FPS, float(os.environ.get("PANEL_CAMERA_FPS", "30")))
        got = int(cap.get(cv2.CAP_PROP_FOURCC)).to_bytes(4, "little").decode("latin1")
        print(
            f"[camera] {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))} "
            f"{got} @ {cap.get(cv2.CAP_PROP_FPS):g} fps requested",
            flush=True,
        )
        # The C270 halves its frame rate whenever auto-exposure wants more than
        # one frame time of light, which under indoor lighting is always: 30
        # fps negotiated, 15 delivered. Telling it not to (exposure_dynamic_
        # framerate=0) holds 30 and lets gain, and the ring light, do the work.
        # OpenCV has no property for this UVC control, so go through v4l2-ctl.
        if os.environ.get("PANEL_CAMERA_DYNAMIC_FPS", "0") == "0" and shutil.which("v4l2-ctl"):
            dev = f"/dev/video{self.index}" if isinstance(self.index, int) else str(self.index)
            try:
                subprocess.run(
                    ["v4l2-ctl", "-d", dev, "--set-ctrl=exposure_dynamic_framerate=0"],
                    check=False, capture_output=True, timeout=3,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                print(f"[camera] could not pin the frame rate: {exc}", flush=True)
        self._camera_ok = True
        self._error = ""
        return cap

    def _make_tracker(self):
        if not HAVE_MEDIAPIPE or not self.model_path:
            return None
        vision = mp.tasks.vision
        options = vision.HandLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=1,
            min_hand_detection_confidence=0.65,
            min_hand_presence_confidence=0.65,
            min_tracking_confidence=0.65,
        )
        return vision.HandLandmarker.create_from_options(options)

    def _run(self) -> None:
        cap = self._open()
        tracker = None
        frames = 0
        window_start = time.monotonic()

        while not self._stop.is_set():
            if cap is None:
                # Keep retrying: a webcam unplugged mid-demo should recover
                # when it comes back, not take the panel down with it.
                time.sleep(1.0)
                cap = self._open()
                continue

            ok, frame = cap.read()
            if not ok:
                self._camera_ok = False
                self._error = "camera read failed; reopening"
                cap.release()
                cap = None
                continue

            frame = cv2.flip(frame, 1)  # mirror: the panel is used like a mirror
            now = time.monotonic()

            want = self._tracking_wanted and HAVE_MEDIAPIPE and self.model_path is not None
            if want and tracker is None:
                try:
                    tracker = self._make_tracker()
                except Exception as exc:  # pragma: no cover
                    self._error = f"hand tracker failed to start: {exc}"
                    tracker = None
            if not want and tracker is not None:
                tracker.close()
                tracker = None
                with self._lock:
                    self._reading = None
                    self._overlay = None
                self._last_palm_px = None
            self._tracking_active = tracker is not None

            overlay = None
            if tracker is not None:
                overlay = self._track(tracker, frame, now)

            with self._lock:
                self._frame = frame
                self._overlay = overlay
            self._frame_seq += 1

            frames += 1
            if now - window_start >= 1.0:
                self._fps = frames / (now - window_start)
                frames = 0
                window_start = now

        if tracker is not None:
            tracker.close()
        if cap is not None:
            cap.release()

    # --- tracking ----------------------------------------------------------

    def _track(self, tracker, frame: np.ndarray, now: float) -> np.ndarray:
        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = tracker.detect_for_video(image, int(now * 1000))
        landmarks = result.hand_landmarks[0] if result.hand_landmarks else None

        overlay = frame.copy()
        if landmarks is None:
            with self._lock:
                self._reading = None
            self._last_palm_px = None
            self._pinch_latched = False
            self._banner(overlay, "no hand in view", (150, 150, 150))
            return overlay

        points = np.array([(lm.x * width, lm.y * height) for lm in landmarks], dtype=float)
        palm_px = np.median(points[list(PALM_LANDMARKS)], axis=0)
        palm_width_px = float(np.linalg.norm(points[INDEX_MCP] - points[PINKY_MCP]))

        # Pinch, normalised against this hand's own size so it survives the hand
        # moving toward and away from the camera. Hysteresis matches the
        # PINCH_GRAB / PINCH_RELEASE pair in src/hand/types.ts.
        #
        # ratio = tip gap / palm width. MediaPipe's tip landmarks sit on the
        # finger pads, so two fingers that are physically touching still read
        # ~0.15–0.25 apart; an open hand reads ~0.9–1.2. The curve maps
        # PINCH_CLOSED → 1.0 and PINCH_OPEN → 0.0, so with the defaults a grab
        # (0.7) needs ratio ≤ 0.38 and lets go (0.5) at 0.5 — fingers close,
        # not fused. The old 0.62 scale needed ≤ 0.19, i.e. a perfect touch.
        gap = float(np.linalg.norm(points[THUMB_TIP] - points[INDEX_TIP]))
        span = max(palm_width_px, 1.0)
        ratio = gap / span
        pinch = clamp(1.0 - (ratio - PINCH_CLOSED) / max(PINCH_OPEN - PINCH_CLOSED, 1e-3), 0.0, 1.0)
        self._pinch_ratio = ratio
        self._pinch_latched = pinch >= 0.7 if not self._pinch_latched else pinch > 0.5

        handedness = "right"
        confidence = 1.0
        if result.handedness and result.handedness[0]:
            top = result.handedness[0][0]
            # Frame is mirrored, so MediaPipe's label is the opposite hand.
            handedness = "left" if top.category_name.lower().startswith("r") else "right"
            confidence = float(top.score)

        reading = self._to_sim_frame(points, palm_px, palm_width_px, pinch, handedness, confidence, now, width, height)
        with self._lock:
            self._reading = reading

        self._draw(overlay, points, pinch)
        return overlay

    def _to_sim_frame(
        self,
        points: np.ndarray,
        palm_px: np.ndarray,
        palm_width_px: float,
        pinch: float,
        handedness: str,
        confidence: float,
        now: float,
        width: int,
        height: int,
    ) -> HandReading:
        """Pixels -> the sim's metre frame (+x right, +y UP, origin centred)."""
        m_per_px = self.scene_width_m / float(width)

        def to_m(p: np.ndarray) -> tuple[float, float]:
            # y flips: image y grows downward, the sim's grows upward.
            return ((p[0] - width / 2.0) * m_per_px, (height / 2.0 - p[1]) * m_per_px)

        x_m, y_m = to_m(palm_px)

        # Depth: the ToF sensor when it exists, otherwise apparent hand size.
        # The size estimate assumes a ~90 mm knuckle span, which is a guess, and
        # the API labels it as one rather than pretending it is a measurement.
        depth_mm = depth_at_palm_mm(palm_px)
        if depth_mm is not None:
            z_m = depth_mm / 1000.0
        else:
            reference_px = 0.18 * width  # palm span at roughly the plane
            z_m = clamp((palm_width_px - reference_px) * m_per_px * 2.0, -0.35, 0.35)

        vx = vy = 0.0
        if self._last_palm_px is not None:
            dt = max(now - self._last_palm_t, 1e-3)
            prev_x, prev_y = to_m(self._last_palm_px)
            vx, vy = (x_m - prev_x) / dt, (y_m - prev_y) / dt
        self._last_palm_px = palm_px.copy()
        self._last_palm_t = now

        landmarks_m = []
        for p in points:
            lx, ly = to_m(p)
            landmarks_m.append((lx, ly, z_m))

        return HandReading(
            t_ms=now * 1000.0,
            handedness=handedness,
            confidence=confidence,
            palm_m=(x_m, y_m, z_m),
            palm_velocity_ms=(vx, vy, 0.0),
            pinch=pinch,
            landmarks_m=landmarks_m,
            palm_n=(float(palm_px[0]) / width, float(palm_px[1]) / height),
            landmarks_n=[(float(p[0]) / width, float(p[1]) / height) for p in points],
        )

    # --- drawing -----------------------------------------------------------

    def _draw(self, frame: np.ndarray, points: np.ndarray, pinch: float) -> None:
        pts = points.astype(int)
        for a, b in CONNECTIONS:
            cv2.line(frame, tuple(pts[a]), tuple(pts[b]), BONE_COLOR, 3, cv2.LINE_AA)
        for i, p in enumerate(pts):
            radius = 7 if i in (THUMB_TIP, INDEX_TIP) else 5
            cv2.circle(frame, tuple(p), radius, JOINT_COLOR, -1, cv2.LINE_AA)

        # The pinch gap is the one measurement a demo operator actually needs to
        # see, so it gets drawn as the thing it is: the distance being measured.
        color = PINCH_COLOR if self._pinch_latched else (200, 200, 200)
        cv2.line(frame, tuple(pts[THUMB_TIP]), tuple(pts[INDEX_TIP]), color, 2, cv2.LINE_AA)
        # The ratio is what to look at when tuning PANEL_PINCH_CLOSED/_OPEN.
        label = f"pinch {pinch:.2f}  gap {self._pinch_ratio:.2f}" + ("  GRAB" if self._pinch_latched else "")
        self._banner(frame, label, color)

    @staticmethod
    def _banner(frame: np.ndarray, text: str, color: tuple[int, int, int]) -> None:
        cv2.rectangle(frame, (0, 0), (frame.shape[1], 46), (18, 20, 26), -1)
        cv2.putText(frame, text, (16, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2, cv2.LINE_AA)
