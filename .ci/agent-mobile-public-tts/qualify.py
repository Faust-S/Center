"""Qualification of public upstream model assets only. No private access."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import wave
import array

MODEL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
         128774318, "82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427")
ENGINE = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3/sherpa-onnx-v2.0.3-linux-x64-shared.tar.bz2",
          29936514, "615b1bf0140bf09051c15fde6579e48543696352ebd477217d2e69b49d9aec13")
FILES = {
    "duration_predictor.int8.onnx": "duration-predictor",
    "text_encoder.int8.onnx": "text-encoder",
    "vector_estimator.int8.onnx": "vector-estimator",
    "vocoder.int8.onnx": "vocoder",
    "tts.json": "tts-json",
    "unicode_indexer.bin": "unicode-indexer",
    "voice.bin": "voice-style",
}

def download(pin, path):
    url, size, digest = pin
    count = 0
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=60) as source, path.open("xb") as out:
        if not source.geturl().startswith("https://"):
            raise ValueError("UPSTREAM_PROTOCOL")
        while chunk := source.read(1024 * 1024):
            count += len(chunk)
            if count > size:
                raise ValueError("UPSTREAM_SIZE")
            h.update(chunk)
            out.write(chunk)
    if count != size or h.hexdigest() != digest:
        raise ValueError("UPSTREAM_IDENTITY")

def extract_model(path, root):
    root.mkdir()
    observed = set()
    with tarfile.open(path, "r:bz2") as tar:
        for item in tar:
            name = pathlib.PurePosixPath(item.name)
            if name.name not in FILES:
                continue
            if (name.is_absolute() or ".." in name.parts or len(name.parts) != 2 or
                    name.parts[0] != "sherpa-onnx-supertonic-3-tts-int8-2026-05-11" or
                    not item.isfile() or name.name in observed or not 0 < item.size <= 128 * 1024 * 1024):
                raise ValueError("MODEL_MEMBER")
            with tar.extractfile(item) as source, (root / name.name).open("xb") as out:
                h = hashlib.sha256()
                count = 0
                while chunk := source.read(1024 * 1024):
                    count += len(chunk)
                    if count > item.size:
                        raise ValueError("MODEL_MEMBER_SIZE")
                    h.update(chunk)
                    out.write(chunk)
            if count != item.size:
                raise ValueError("MODEL_MEMBER_SIZE")
            observed.add(name.name)
            print("TTS_FILE=" + json.dumps({"name": name.name, "bytes": count, "sha256": h.hexdigest()}, separators=(",", ":")), flush=True)
    if observed != set(FILES):
        raise ValueError("MODEL_MEMBERS")

def inspect_audio(path):
    with wave.open(str(path), "rb") as wav:
        count, rate = wav.getnframes(), wav.getframerate()
        if not (wav.getnchannels() == 1 and wav.getsampwidth() == 2 and 8000 <= rate <= 48000 and
                rate // 2 <= count <= 30 * rate):
            raise ValueError("TTS_AUDIO_FORMAT")
        data = array.array("h", wav.readframes(count))
        if len(data) != count or max(abs(x) for x in data) < 100 or sum(x != 0 for x in data) < rate // 5:
            raise ValueError("TTS_AUDIO_EMPTY")
    return {"sampleRate": rate, "samples": count, "durationMs": count * 1000 // rate}

def main():
    with tempfile.TemporaryDirectory(prefix="iwxa-public-tts-") as td:
        root = pathlib.Path(td)
        model, engine = root / "model.tar.bz2", root / "engine.tar.bz2"
        download(MODEL, model)
        print("TTS_MODEL_ARCHIVE=PASS", flush=True)
        extract_model(model, root / "model")
        download(ENGINE, engine)
        print("TTS_ENGINE_ARCHIVE=PASS", flush=True)
        with tarfile.open(engine, "r:bz2") as tar:
            tar.extractall(root / "runtime", filter="data")
        bins = list((root / "runtime").rglob("sherpa-onnx-offline-tts"))
        if len(bins) != 1 or not bins[0].is_file():
            raise ValueError("TTS_ENGINE_BINARY")
        exe = bins[0]
        env = dict(os.environ)
        libs = sorted({str(f.parent) for f in (root / "runtime").rglob("*.so*")})
        env["LD_LIBRARY_PATH"] = ":".join(libs)
        for lang, sentence in (("en", "The local assistant reads this message aloud."),
                               ("ru", "\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a \u0447\u0438\u0442\u0430\u0435\u0442 \u044d\u0442\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435.")):
            dest = root / (lang + ".wav")
            args = [str(exe), *["--supertonic-" + role + "=" + str(root / "model" / file)
                                 for file, role in FILES.items()],
                    "--sid=0", "--lang=" + lang, "--num-threads=2", "--output-filename=" + str(dest), sentence]
            p = subprocess.run(args, env=env, capture_output=True, timeout=180)
            if p.returncode:
                # All command inputs here are public. Bounded diagnostic.
                print(p.stderr.decode("utf-8", "replace")[-4000:], flush=True)
                raise ValueError("TTS_INFERENCE_" + lang.upper())
            print("TTS_AUDIO_" + lang.upper() + "=" + json.dumps(inspect_audio(dest), separators=(",", ":")), flush=True)
        print("TTS_PUBLIC_QUALIFICATION=PASS", flush=True)

if __name__ == "__main__":
    main()
