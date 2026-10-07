#!/usr/bin/env python3
"""Local-only hand tracking. Emits move intent; never controls mouse/keyboard.

Open fingers -> pinch for 0.45 s -> drag continuously in X/Y -> release to leave in place.
No frame, landmark or biometric data is stored or transmitted.
"""
import argparse
import json
import math
import os
from pathlib import Path
import signal
import sys
import threading
import time
import uuid


class Gesture:
    def __init__(self, *, pinch_enter=0.45, pinch_release=0.72,
                 open_threshold=0.85, arm_seconds=0.45, open_seconds=0.35):
        self.pinch_enter = pinch_enter
        self.pinch_release = pinch_release
        self.open_threshold = open_threshold
        self.arm_seconds = arm_seconds
        self.open_seconds = open_seconds
        self.reset()
        self.cooldown = 0
        self.open_since = None
        self.ready = False

    def reset(self):
        self.since = None
        self.origin = None
        self.token = None
        self.filtered = None
        self.last_sample = None

    def feed(self, landmarks, now):
        if landmarks is None:
            if self.token:
                token = self.token
                self.reset(); self.ready = False; self.open_since = None
                return {'event': 'cancel', 'token': token}
            self.reset(); self.ready = False; self.open_since = None
            return None
        def point(i): return (landmarks[i].x, landmarks[i].y)
        def distance(i, j): return math.dist(point(i), point(j))
        scale = max(distance(5, 17), .035)
        pinch = distance(4, 8) / scale
        center = ((landmarks[0].x + landmarks[9].x) / 2,
                  (landmarks[0].y + landmarks[9].y) / 2)
        if now < self.cooldown:
            return None
        if self.token:
            token = self.token
            if pinch > self.pinch_release:
                self.reset(); self.ready = False; self.open_since = None
                self.cooldown = now + .5
                return {'event': 'release', 'token': token}
            dt = min(.2, max(.001, now - self.last_sample))
            distance_moved = math.dist(center, self.filtered)
            # Stable at rest, quicker during deliberate movement. No camera frames leave this process.
            tau = .025 if distance_moved > .035 else .065
            alpha = 1 - math.exp(-dt / tau)
            self.filtered = tuple(a + alpha * (b - a) for a, b in zip(self.filtered, center))
            self.last_sample = now
            return {'event': 'drag', 'token': token, 'x': self.filtered[0], 'y': self.filtered[1]}
        if pinch > self.open_threshold:
            self.since = None
            if self.open_since is None: self.open_since = now
            if now - self.open_since >= self.open_seconds: self.ready = True
            return None
        self.open_since = None
        if pinch < self.pinch_enter and self.ready:
            if self.since is None:
                self.since = now
                self.origin = center
            if math.dist(center, self.origin) > .09:
                self.since = now; self.origin = center
            if now - self.since >= self.arm_seconds:
                self.token = uuid.uuid4().hex
                self.since = now
                self.filtered = center
                self.last_sample = now
                return {'event': 'arm', 'token': self.token, 'x': center[0], 'y': center[1]}
        else:
            self.since = None
        return None


def emit(event, **values):
    print(json.dumps({'event': event, 'at': time.time(), **values}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--camera', default='/dev/video0')
    parser.add_argument('--fps', type=float, default=24)
    parser.add_argument('--pinch-enter', type=float, default=.45)
    parser.add_argument('--pinch-release', type=float, default=.72)
    parser.add_argument('--open-threshold', type=float, default=.85)
    parser.add_argument('--arm-seconds', type=float, default=.45)
    parser.add_argument('--open-seconds', type=float, default=.35)
    parser.add_argument('--probe-seconds', type=float, default=0, help='Measure camera/model without any move events')
    args = parser.parse_args()
    import cv2
    import mediapipe as mp
    cv2.setNumThreads(1)
    parent = os.getppid()
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    emit('status', detail='Preparando seguimiento local de manos')
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=args.model,
            delegate=mp.tasks.BaseOptions.Delegate.CPU),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_hands=1,
        min_hand_detection_confidence=.7, min_hand_presence_confidence=.7,
        min_tracking_confidence=.7)
    cap = cv2.VideoCapture(args.camera, cv2.CAP_V4L2)
    if not cap.isOpened():
        cap.release()
        raise RuntimeError(f'No se pudo abrir {args.camera}. Compruebe conexión y permisos de cámara.')
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    latest = [None, 0.0]
    lock = threading.Lock()
    def capture():
        while not stop.is_set():
            ok, frame = cap.read()
            if not ok:
                stop.set(); break
            with lock: latest[:] = [frame, time.monotonic()]
    reader = threading.Thread(target=capture, daemon=True)
    reader.start()
    gesture = Gesture(pinch_enter=args.pinch_enter, pinch_release=args.pinch_release,
                      open_threshold=args.open_threshold, arm_seconds=args.arm_seconds,
                      open_seconds=args.open_seconds)
    last_frame = 0
    last_heartbeat = 0
    last_hover = 0
    last_timestamp = -1
    frames = 0
    inference_seconds = 0.0
    probe_started = time.monotonic()
    try:
        with mp.tasks.vision.HandLandmarker.create_from_options(options) as detector:
            emit('ready', detail='Manos activas · abra la mano antes de pinzar')
            while not stop.is_set() and os.getppid() == parent:
                start = time.monotonic()
                if args.probe_seconds and start - probe_started >= args.probe_seconds:
                    break
                with lock: frame, captured = latest
                if frame is None or captured == last_frame:
                    stop.wait(.025); continue
                if start - captured > .5:
                    emit('cancel', token=gesture.token)
                    gesture.reset(); gesture.ready = False
                    stop.wait(.05); continue
                last_frame = captured
                # Mirroring makes a rightward physical hand motion mean right on screen.
                image = mp.Image(image_format=mp.ImageFormat.SRGB,
                    data=cv2.cvtColor(cv2.flip(frame, 1), cv2.COLOR_BGR2RGB))
                timestamp = max(last_timestamp + 1, int(start * 1000)); last_timestamp = timestamp
                inference_start = time.perf_counter()
                result = detector.detect_for_video(image, timestamp)
                inference_seconds += time.perf_counter() - inference_start
                frames += 1
                event = gesture.feed(result.hand_landmarks[0] if result.hand_landmarks else None, time.monotonic())
                if event and not args.probe_seconds: emit(**event)
                # Show the target screen before pinching, without moving anything.
                # Keep a rejected grab's explanation visible until the hand opens.
                if (not args.probe_seconds and result.hand_landmarks and
                        gesture.token is None and gesture.open_since is not None and
                        start - last_hover >= .25):
                    landmarks = result.hand_landmarks[0]
                    emit('hover', x=(landmarks[0].x + landmarks[9].x) / 2,
                         y=(landmarks[0].y + landmarks[9].y) / 2)
                    last_hover = start
                if start - last_heartbeat > 1:
                    emit('heartbeat'); last_heartbeat = start
                stop.wait(max(0, 1 / max(1, args.fps) - (time.monotonic() - start)))
    finally:
        stop.set()
        reader.join(timeout=.5)
        cap.release()
        if args.probe_seconds:
            emit('probe', frames=frames, inference_ms=round(1000 * inference_seconds / max(1, frames), 2))
        emit('stopped')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', detail=str(error)[:200])
        sys.exit(1)
