"""Webcam hand-tracking physics demo for the HackMIT interaction prototype.

Controls
--------
* Point with your index finger to move the cyan cursor.
* Touch the ball with a thumb-index pinch to grab it.
* Open your hand near the ball and move your palm to push it.
* Press R to reset the ball, Q or Esc to quit.

The demo uses MediaPipe only for 2-D hand position.  Add a real depth reading
to ``depth_at_cursor_mm`` before treating a visual overlap as physical contact.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np


MODEL_PATH = Path(__file__).with_name("hand_landmarker.task")
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/latest/hand_landmarker.task"
)

# Grab tuning. Increase RELEASE_RATIO or TRACKING_GRACE_SECONDS if a fast
# movement still releases too easily. Reduce them if releases feel sluggish.
PINCH_START_RATIO = 0.48
PINCH_RELEASE_RATIO = 0.78
PINCH_CONFIRM_FRAMES = 2
RELEASE_CONFIRM_FRAMES = 6
TRACKING_GRACE_SECONDS = 0.22

# BGR colors for the virtual hand. Change these if you want another skin tone.
HAND_FILL_COLOR = (142, 188, 238)  # warm light skin tone in BGR
HAND_OUTLINE_COLOR = (76, 112, 156)


# MediaPipe landmark indices.  Keeping this list small makes the palm center
# stable even while fingers bend, unlike averaging all 21 landmarks.
WRIST = 0
THUMB_TIP = 4
INDEX_MCP = 5
INDEX_PIP = 6
INDEX_TIP = 8
MIDDLE_MCP = 9
RING_MCP = 13
PINKY_MCP = 17
PALM_LANDMARKS = (WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP)


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


@dataclass
class ExponentialSmoother:
    """Adaptive smoothing: stable when resting, responsive while moving."""

    value: Optional[np.ndarray] = None

    def update(self, sample: np.ndarray, dt: float) -> np.ndarray:
        if self.value is None:
            self.value = sample.astype(float)
            return self.value.copy()
        speed = float(np.linalg.norm(sample - self.value) / max(dt, 1e-3))
        # A higher alpha at speed keeps the cursor from lagging behind a hand.
        alpha = clamp(0.16 + speed / 1800.0, 0.16, 0.72)
        self.value = alpha * sample + (1.0 - alpha) * self.value
        return self.value.copy()


@dataclass
class Ball:
    position: np.ndarray
    velocity: np.ndarray
    radius: float = 42.0

    def reset(self, width: int, height: int) -> None:
        self.position = np.array([width * 0.5, height * 0.52], dtype=float)
        self.velocity = np.zeros(2, dtype=float)

    def update(self, dt: float, width: int, height: int) -> None:
        self.velocity *= 0.992 ** (dt * 60.0)  # gentle air resistance
        self.position += self.velocity * dt
        for axis, limit in ((0, width), (1, height)):
            low = self.radius
            high = limit - self.radius
            if self.position[axis] < low:
                self.position[axis] = low
                self.velocity[axis] = abs(self.velocity[axis]) * 0.74
            elif self.position[axis] > high:
                self.position[axis] = high
                self.velocity[axis] = -abs(self.velocity[axis]) * 0.74


class HandInteraction:
    """Derives a cursor, pinch state, and open-palm point from one hand."""

    def __init__(self) -> None:
        self.cursor_smoother = ExponentialSmoother()
        self.palm_smoother = ExponentialSmoother()
        self.cursor = np.zeros(2, dtype=float)
        self.palm = np.zeros(2, dtype=float)
        self.cursor_velocity = np.zeros(2, dtype=float)
        self.palm_velocity = np.zeros(2, dtype=float)
        self.pinch_frames = 0
        self.release_frames = 0
        self.is_pinching = False
        self.hand_visible = False
        self.seconds_since_seen = 0.0

    def update(self, landmarks, width: int, height: int, dt: float) -> None:
        points = np.array([(lm.x * width, lm.y * height) for lm in landmarks], dtype=float)
        previous_cursor, previous_palm = self.cursor.copy(), self.palm.copy()
        self.cursor = self.cursor_smoother.update(points[INDEX_TIP], dt)
        # Median resists one bad landmark better than a simple average.
        raw_palm = np.median(points[list(PALM_LANDMARKS)], axis=0)
        self.palm = self.palm_smoother.update(raw_palm, dt)
        self.cursor_velocity = (self.cursor - previous_cursor) / max(dt, 1e-3)
        self.palm_velocity = (self.palm - previous_palm) / max(dt, 1e-3)

        palm_width = np.linalg.norm(points[INDEX_MCP] - points[PINKY_MCP])
        pinch_distance = np.linalg.norm(points[THUMB_TIP] - points[INDEX_TIP])
        # Hysteresis: opening requires a much larger gap than closing. This
        # stops a fast, slightly blurry pinch from flickering between states.
        threshold = max(
            24.0,
            palm_width * (PINCH_RELEASE_RATIO if self.is_pinching else PINCH_START_RATIO),
        )
        raw_pinch = pinch_distance < threshold
        self.pinch_frames = self.pinch_frames + 1 if raw_pinch else 0
        self.release_frames = 0 if raw_pinch else self.release_frames + 1
        if self.pinch_frames >= PINCH_CONFIRM_FRAMES:
            self.is_pinching = True
        if self.release_frames >= RELEASE_CONFIRM_FRAMES:
            self.is_pinching = False
        self.hand_visible = True
        self.seconds_since_seen = 0.0

    def clear(self, dt: float) -> None:
        """Keep a grab alive through brief tracker dropouts during fast motion."""
        self.seconds_since_seen += dt
        if self.seconds_since_seen < TRACKING_GRACE_SECONDS:
            return
        self.hand_visible = False
        self.pinch_frames = self.release_frames = 0
        self.is_pinching = False
        self.cursor_velocity *= 0
        self.palm_velocity *= 0


def depth_at_cursor_mm(_: np.ndarray) -> Optional[float]:
    """Hook for VL53L7CX integration.

    Return the depth at the cursor in millimeters after mapping camera pixels
    to the calibrated 8x8 ToF grid.  Returning None preserves camera-only use.
    """
    return None


def require_hand_model() -> Path:
    """Give a useful setup error instead of an opaque MediaPipe exception."""
    if MODEL_PATH.is_file():
        return MODEL_PATH
    raise FileNotFoundError(
        "Missing hand_landmarker.task. Download the official MediaPipe model with:\n"
        f'  Invoke-WebRequest -Uri "{MODEL_URL}" -OutFile "{MODEL_PATH}"'
    )


def apply_open_palm_push(ball: Ball, hand: HandInteraction, dt: float) -> bool:
    """A soft circular palm collider; only active when not pinching."""
    if not hand.hand_visible or hand.is_pinching:
        return False
    palm_radius = 70.0
    delta = ball.position - hand.palm
    distance = float(np.linalg.norm(delta))
    contact_distance = ball.radius + palm_radius
    if distance >= contact_distance:
        return False
    normal = delta / distance if distance > 1e-4 else np.array([1.0, 0.0])
    penetration = contact_distance - distance
    # Position correction prevents the hand collider from tunneling through.
    ball.position += normal * penetration
    toward_ball_speed = float(np.dot(hand.palm_velocity, normal))
    if toward_ball_speed > 0:
        ball.velocity += normal * toward_ball_speed * 0.85
    return True


def draw_overlay(frame: np.ndarray, ball: Ball, hand: HandInteraction, grabbed: bool, palm_contact: bool) -> None:
    cv2.circle(frame, tuple(ball.position.astype(int)), int(ball.radius), (66, 166, 245), -1)
    cv2.circle(frame, tuple(ball.position.astype(int)), int(ball.radius), (255, 255, 255), 2)
    if hand.hand_visible:
        cursor_color = (0, 255, 255) if hand.is_pinching else (255, 255, 0)
        cv2.circle(frame, tuple(hand.cursor.astype(int)), 11, cursor_color, 2)
        cv2.circle(frame, tuple(hand.palm.astype(int)), 70, (120, 120, 120), 1)
        label = "GRABBING" if grabbed else "PINCH" if hand.is_pinching else "PALM PUSH" if palm_contact else "POINT"
        cv2.putText(frame, label, (18, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.75, cursor_color, 2)
    else:
        cv2.putText(frame, "Show one hand to the camera", (18, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (220, 220, 220), 2)
    cv2.putText(frame, "Index: cursor | Thumb + index: grab | Open palm: push | R: reset | Q: quit", (18, frame.shape[0] - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (235, 235, 235), 1)


def draw_virtual_hand(frame: np.ndarray, landmarks) -> None:
    """Draw a simple, rounded hand avatar instead of a landmark-debug skeleton."""
    height, width = frame.shape[:2]
    points = np.array([(int(lm.x * width), int(lm.y * height)) for lm in landmarks], dtype=np.int32)
    avatar = frame.copy()
    fill, outline = HAND_FILL_COLOR, HAND_OUTLINE_COLOR

    # Use a hand-shaped polygon traced from the wrist and knuckle landmarks.
    # This intentionally keeps the sharper, triangular palm silhouette.
    knuckle_center = np.mean(points[[INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]], axis=0)
    palm_points = points[[WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]]
    hull = cv2.convexHull(palm_points)
    cv2.fillConvexPoly(avatar, hull, fill, cv2.LINE_AA)
    cv2.polylines(avatar, [hull], True, outline, 2, cv2.LINE_AA)

    fingers = ((1, 4, 19), (5, 8, 18), (9, 12, 20), (13, 16, 18), (17, 20, 15))
    for start, tip, thickness in fingers:
        cv2.line(avatar, tuple(points[start]), tuple(points[tip]), fill, thickness, cv2.LINE_AA)
        cv2.line(avatar, tuple(points[start]), tuple(points[tip]), outline, 2, cv2.LINE_AA)
        cv2.circle(avatar, tuple(points[tip]), thickness // 2, fill, -1, cv2.LINE_AA)
        cv2.circle(avatar, tuple(points[tip]), thickness // 2, outline, 2, cv2.LINE_AA)

    wrist_width = 22
    wrist_end = points[WRIST] + (points[WRIST] - knuckle_center).astype(np.int32) // 2
    cv2.line(avatar, tuple(points[WRIST]), tuple(wrist_end), fill, wrist_width, cv2.LINE_AA)
    cv2.line(avatar, tuple(points[WRIST]), tuple(wrist_end), outline, 2, cv2.LINE_AA)
    cv2.addWeighted(avatar, 0.86, frame, 0.14, 0, frame)


def main() -> None:
    model_path = require_hand_model()
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam 0. Try a different camera index in VideoCapture().")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    hand = HandInteraction()
    ball = Ball(np.array([640.0, 360.0]), np.zeros(2, dtype=float))
    grabbed = False
    previous_time = time.monotonic()
    # MediaPipe 1.x uses the Tasks API; the old mp.solutions.hands API was
    # removed. VIDEO mode preserves tracking between webcam frames.
    vision = mp.tasks.vision
    options = vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.65,
        min_hand_presence_confidence=0.65,
        min_tracking_confidence=0.65,
    )
    with vision.HandLandmarker.create_from_options(options) as tracker:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)  # mirror interaction like a touchscreen
            height, width = frame.shape[:2]
            now = time.monotonic()
            dt = clamp(now - previous_time, 1 / 120.0, 1 / 15.0)
            previous_time = now

            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            result = tracker.detect_for_video(mp_image, int(now * 1000))
            detected_landmarks = result.hand_landmarks[0] if result.hand_landmarks else None
            if detected_landmarks:
                hand.update(detected_landmarks, width, height, dt)
            else:
                hand.clear(dt)

            cursor_distance = float(np.linalg.norm(ball.position - hand.cursor))
            if hand.is_pinching and hand.hand_visible and (grabbed or cursor_distance < ball.radius + 18):
                grabbed = True
                ball.position = hand.cursor.copy()
                ball.velocity = hand.cursor_velocity.copy()
            elif grabbed:
                grabbed = False

            palm_contact = False
            if not grabbed:
                palm_contact = apply_open_palm_push(ball, hand, dt)
                ball.update(dt, width, height)

            # Reserved for a calibrated ToF reading; don't fake 3-D contact.
            _depth_mm = depth_at_cursor_mm(hand.cursor) if hand.hand_visible else None
            if detected_landmarks:
                draw_virtual_hand(frame, detected_landmarks)
            draw_overlay(frame, ball, hand, grabbed, palm_contact)
            cv2.imshow("HackMIT Hand Physics Demo", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("r"):
                ball.reset(width, height)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
