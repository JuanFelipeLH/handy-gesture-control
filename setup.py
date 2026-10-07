#!/usr/bin/env python3
"""Set up local MediaPipe dependencies and download the official hand model."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv


DATA_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "handy-gesture-control"
CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "handy-gesture-control"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
REQUIREMENTS = ["mediapipe>=0.10.30,<0.11", "opencv-contrib-python>=4.10,<5"]
DEFAULT_CONFIG = {
    "camera": "/dev/video0",
    "fps": 24,
    "pinchEnter": 0.45,
    "pinchRelease": 0.72,
    "openThreshold": 0.85,
    "armSeconds": 0.45,
    "openSeconds": 0.35,
}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    python = DATA_DIR / "venv/bin/python"
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(DATA_DIR / "venv")

    subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", *REQUIREMENTS],
        check=True,
    )

    model = DATA_DIR / "hand_landmarker.task"
    if model.exists() and hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA256:
        model.unlink()
    if not model.exists():
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "Handy-Gesture-Control/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read(30_000_001)
        if len(payload) > 30_000_000:
            raise RuntimeError("The model download exceeded the expected size")
        temporary = model.with_suffix(".download")
        temporary.write_bytes(payload)
        if hashlib.sha256(payload).hexdigest() != MODEL_SHA256:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("The downloaded model checksum does not match the expected SHA-256")
        temporary.replace(model)

    provenance = {
        "model_url": MODEL_URL,
        "sha256": MODEL_SHA256,
        "source": "Google MediaPipe Hand Landmarker",
    }
    (DATA_DIR / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    config = CONFIG_DIR / "config.json"
    if not config.exists():
        config.write_text(json.dumps(DEFAULT_CONFIG, indent=2) + "\n")

    subprocess.run([str(python), "-m", "pip", "check"], check=True)
    print(f"Dependencias y modelo instalados en: {DATA_DIR}")
    print(f"Configuración personal: {config}")
    print("La extensión inicia con la cámara apagada; actívela desde el menú superior.")


if __name__ == "__main__":
    main()
