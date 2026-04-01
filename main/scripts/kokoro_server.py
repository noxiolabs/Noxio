#!/usr/bin/env python3
"""
kokoro_server.py — FastAPI HTTP server wrapping kokoro-onnx for text-to-speech.

Runs on CPU only — zero VRAM cost, no conflict with LLM or image generation.
Lazy-loads the ONNX model on first /synthesise request.

Args:
    --port       PORT       Port to listen on (default: 8880)
    --model-dir  MODEL_DIR  Directory containing kokoro-v0_19.onnx and voices.bin
                            (default: current working directory)

Endpoints:
    GET  /health     → {"status": "ok"}
    POST /synthesise → JSON {text, voice="af_heart", speed=1.0} → WAV bytes
"""

import argparse
import io
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [kokoro] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

_model = None
_model_dir = "."


def get_model():
    global _model
    if _model is None:
        import os  # noqa: PLC0415

        from kokoro_onnx import Kokoro  # noqa: PLC0415

        onnx_path   = os.path.join(_model_dir, "kokoro-v0_19.onnx")
        voices_path = os.path.join(_model_dir, "voices.bin")

        log.info(f"Loading Kokoro ONNX model from '{_model_dir}' …")
        _model = Kokoro(onnx_path, voices_path)
        log.info("Kokoro model loaded.")
    return _model


def create_app():
    from fastapi import FastAPI, HTTPException  # noqa: PLC0415
    from fastapi.responses import Response      # noqa: PLC0415
    from pydantic import BaseModel             # noqa: PLC0415

    app = FastAPI(title="noxio-kokoro")

    class SynthesiseRequest(BaseModel):
        text:  str
        voice: str   = "af_heart"
        speed: float = 1.0

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/synthesise")
    async def synthesise(req: SynthesiseRequest):
        if not req.text.strip():
            raise HTTPException(status_code=400, detail="Empty text")

        try:
            import soundfile as sf  # noqa: PLC0415

            model   = get_model()
            samples, sample_rate = model.create(
                req.text, voice=req.voice, speed=req.speed, lang="en-us"
            )

            buf = io.BytesIO()
            sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
            wav_bytes = buf.getvalue()

            log.info(f"Synthesised {len(req.text)} chars → {len(wav_bytes)} WAV bytes")
            return Response(content=wav_bytes, media_type="audio/wav")

        except Exception as exc:
            log.error(f"Synthesis failed: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(exc))

    return app


def main():
    global _model_dir
    parser = argparse.ArgumentParser(description="Noxio Kokoro TTS server")
    parser.add_argument("--port",      type=int, default=8880, help="Port to listen on")
    parser.add_argument("--model-dir", default=".",            help="Directory with kokoro-v0_19.onnx and voices.bin")
    args = parser.parse_args()
    _model_dir = args.model_dir

    import uvicorn  # noqa: PLC0415

    log.info(f"Kokoro server starting — port={args.port}, model-dir={args.model_dir}")
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
