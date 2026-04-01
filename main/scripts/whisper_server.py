#!/usr/bin/env python3
"""
whisper_server.py — FastAPI HTTP server wrapping faster-whisper for speech-to-text.

Lazy-loads the model on first /transcribe request (CUDA with float16, CPU int8 fallback).
Accepts 16 kHz mono WAV audio in the request body.

Args:
    --port  PORT   Port to listen on (default: 10300)
    --model MODEL  faster-whisper model name (default: medium)

Endpoints:
    GET  /health     → {"status": "ok"}
    POST /transcribe → raw WAV bytes in body → {"text": "..."}
"""

import argparse
import io
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [whisper] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

_model = None
_model_name = "medium"


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel  # noqa: PLC0415

        log.info(f"Loading faster-whisper model '{_model_name}' — this may take a minute …")
        try:
            _model = WhisperModel(_model_name, device="cuda", compute_type="float16")
            log.info("Model loaded on CUDA.")
        except Exception as cuda_err:
            log.warning(f"CUDA unavailable ({cuda_err}) — falling back to CPU int8.")
            _model = WhisperModel(_model_name, device="cpu", compute_type="int8")
            log.info("Model loaded on CPU.")
    return _model


def create_app():
    from fastapi import FastAPI, HTTPException, Request  # noqa: PLC0415

    app = FastAPI(title="noxio-whisper")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/transcribe")
    async def transcribe(request: Request):
        audio_bytes = await request.body()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio body")

        try:
            import soundfile as sf  # noqa: PLC0415

            model = get_model()
            audio_data, _ = sf.read(io.BytesIO(audio_bytes), dtype="float32")

            # Convert stereo to mono
            if audio_data.ndim > 1:
                audio_data = audio_data.mean(axis=1)

            segments, _ = model.transcribe(audio_data, beam_size=5)
            text = "".join(seg.text for seg in segments).strip()
            log.info(f"Transcript ({len(text)} chars): {text[:80]!r}")
            return {"text": text}

        except Exception as exc:
            log.error(f"Transcription failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc))

    return app


def main():
    global _model_name
    parser = argparse.ArgumentParser(description="Noxio Whisper STT server")
    parser.add_argument("--port", type=int, default=10300, help="Port to listen on")
    parser.add_argument("--model", default="medium", help="faster-whisper model name")
    args = parser.parse_args()
    _model_name = args.model

    import uvicorn  # noqa: PLC0415

    log.info(f"Whisper server starting — port={args.port}, model={args.model}")
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
