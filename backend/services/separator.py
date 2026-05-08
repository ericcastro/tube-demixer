import asyncio
import re
from pathlib import Path

import soundfile as sf
import torch
import torchaudio
from demucs.pretrained import get_model
from demucs.apply import apply_model as demucs_apply


MODELS: dict[str, dict] = {
    "htdemucs": {
        "label": "HTDemucs",
        "description": "DeepExtractV2 — your proven baseline. Fast, great quality.",
        "stems": ["drums", "bass", "other", "vocals"],
        "backend": "demucs",
        "model_name": "htdemucs",
    },
    "htdemucs_6s": {
        "label": "HTDemucs 6-stem",
        "description": "Same architecture, adds guitar & piano separation.",
        "stems": ["drums", "bass", "other", "vocals", "guitar", "piano"],
        "backend": "demucs",
        "model_name": "htdemucs_6s",
    },
    "htdemucs_ft": {
        "label": "HTDemucs Fine-tuned",
        "description": "Best Demucs quality. ~4× slower than htdemucs.",
        "stems": ["drums", "bass", "other", "vocals"],
        "backend": "demucs",
        "model_name": "htdemucs_ft",
    },
    "bs_roformer": {
        "label": "BS-RoFormer",
        "description": "2024 SOTA for vocals. Best vocal isolation, outputs 2 stems.",
        "stems": ["vocals", "no_vocals"],
        "backend": "audio_separator",
        "model_filename": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
    },
    "mdx23c": {
        "label": "MDX23C",
        "description": "MDX competition model. Different character — good to compare.",
        "stems": ["drums", "bass", "other", "vocals"],
        "backend": "audio_separator",
        "model_filename": "MDX23C-8KFFT-InstVoc_HQ.ckpt",
    },
}


async def separate(audio_path: str, project_id: str, model_id: str) -> list[dict]:
    """Returns list of {"stem_name": str, "file_path": str}"""
    cfg = MODELS.get(model_id)
    if not cfg:
        raise ValueError(f"Unknown model: {model_id!r}")

    stems_dir = Path(f"data/projects/{project_id}/stems")
    stems_dir.mkdir(exist_ok=True)

    loop = asyncio.get_event_loop()

    if cfg["backend"] == "demucs":
        stem_paths = await loop.run_in_executor(
            None, _run_demucs, audio_path, stems_dir, cfg["model_name"]
        )
    else:
        stem_paths = await loop.run_in_executor(
            None, _run_audio_separator, audio_path, stems_dir, cfg["model_filename"]
        )

    return [{"stem_name": name, "file_path": path} for name, path in stem_paths.items()]


def _run_demucs(audio_path: str, stems_dir: Path, model_name: str) -> dict[str, str]:
    device = "cuda" if torch.cuda.is_available() else "cpu"

    model = get_model(model_name)
    model.eval()
    model.to(device)

    # torchaudio nightly routes all loads through torchcodec regardless of
    # the backend= arg; use soundfile directly to avoid the dependency.
    wav_np, sr = sf.read(audio_path, dtype="float32", always_2d=True)
    wav = torch.from_numpy(wav_np.T)  # (samples, ch) → (ch, samples)

    if sr != model.samplerate:
        wav = torchaudio.functional.resample(wav, sr, model.samplerate)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)

    # normalize as demucs CLI does
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()
    wav = wav.to(device)

    with torch.no_grad():
        sources = demucs_apply(model, wav.unsqueeze(0), progress=True)[0]

    sources = (sources * ref.std() + ref.mean()).cpu()

    stem_paths: dict[str, str] = {}
    for i, name in enumerate(model.sources):
        path = str(stems_dir / f"{name}.wav")
        sf.write(path, sources[i].numpy().T, model.samplerate)
        stem_paths[name] = path

    return stem_paths


def _run_audio_separator(audio_path: str, stems_dir: Path, model_filename: str) -> dict[str, str]:
    from audio_separator.separator import Separator  # lazy import — heavy GPU deps

    sep = Separator(output_dir=str(stems_dir), output_format="WAV")
    sep.load_model(model_filename=model_filename)
    output_files = sep.separate(audio_path)

    stem_paths: dict[str, str] = {}
    for f in output_files:
        # audio-separator names files like "audio_(Vocals)_model_name.wav"
        match = re.search(r'\(([^)]+)\)', Path(f).name)
        stem_name = match.group(1).lower().replace(" ", "_") if match else Path(f).stem
        stem_paths[stem_name] = f

    return stem_paths
