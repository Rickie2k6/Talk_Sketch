import base64
import io
import json
import os
import re
import sys
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_CHECKPOINT_GLOB = ROOT / "lightning_logs" / "version_*" / "checkpoints" / "*.ckpt"
MIN_WIDTH = 16
MIN_HEIGHT = 16
MAX_WIDTH = 1024
MAX_HEIGHT = 256
CONTENT_THRESHOLD = 245
CONTENT_PADDING = 16
COMPONENT_MIN_AREA = 32
COMPONENT_MIN_AREA_RATIO = 0.025
COMPONENT_NEARBY_AREA = 8
COMPONENT_NEARBY_AREA_RATIO = 0.0025
COMPONENT_GAP_TOLERANCE = 72
MAX_REPEATED_RELATIONS = 2
MAX_REPEAT_RATIO = 0.6
MAX_DOT_RATIO = 0.35
MIN_TOKENS_FOR_REPEAT_CHECK = 8


def checkpoint_score(path):
    match = re.search(r"val_ExpRate=([0-9.]+)", path.name)
    if match:
        return (float(match.group(1).rstrip(".")), path.stat().st_mtime)
    return (float("-inf"), path.stat().st_mtime)


def resolve_checkpoint_path():
    configured = os.environ.get("COMER_CHECKPOINT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    candidates = sorted(ROOT.glob("lightning_logs/version_*/checkpoints/*.ckpt"))
    if not candidates:
        return ROOT / "lightning_logs" / "version_0" / "checkpoints" / "epoch=151-step=57151-val_ExpRate=0.6365.ckpt"

    return max(candidates, key=checkpoint_score)


def normalize_latex(latex):
    return " ".join(str(latex or "").split())


def tokenize_latex(latex):
    return [token for token in normalize_latex(latex).split(" ") if token]


def repeated_ngram_count(tokens, size=3):
    if len(tokens) < size * 2:
        return 0

    counts = {}
    for index in range(len(tokens) - size + 1):
        ngram = tuple(tokens[index : index + size])
        counts[ngram] = counts.get(ngram, 0) + 1

    return max(counts.values(), default=0)


def assess_latex_quality(latex):
    normalized = normalize_latex(latex)
    tokens = tokenize_latex(normalized)
    issues = []

    if not tokens:
        issues.append("empty")
        return {"normalized": normalized, "issues": issues, "penalty": 999}

    relation_count = sum(token in {"=", "\\leq", "\\geq", "<", ">"} for token in tokens)
    dot_count = sum(token == "\\cdot" for token in tokens)
    unique_ratio = len(set(tokens)) / max(1, len(tokens))
    repeat_ratio = 1 - unique_ratio
    max_trigram_repeat = repeated_ngram_count(tokens, size=3)

    if relation_count > MAX_REPEATED_RELATIONS:
        issues.append("too_many_relations")

    if len(tokens) >= MIN_TOKENS_FOR_REPEAT_CHECK and repeat_ratio > MAX_REPEAT_RATIO:
        issues.append("high_token_repetition")

    if len(tokens) >= MIN_TOKENS_FOR_REPEAT_CHECK and max_trigram_repeat >= 3:
        issues.append("repeated_phrase")

    if len(tokens) >= MIN_TOKENS_FOR_REPEAT_CHECK and (dot_count / len(tokens)) > MAX_DOT_RATIO:
        issues.append("too_many_multiplication_dots")

    return {"normalized": normalized, "issues": issues, "penalty": len(issues)}


def get_decode_presets(model):
    defaults = {
        "beam_size": int(getattr(model.hparams, "beam_size", 10)),
        "max_len": int(getattr(model.hparams, "max_len", 200)),
        "alpha": float(getattr(model.hparams, "alpha", 1.0)),
        "early_stopping": bool(getattr(model.hparams, "early_stopping", False)),
        "temperature": float(getattr(model.hparams, "temperature", 1.0)),
    }

    presets = [
        defaults,
        {**defaults, "beam_size": max(6, defaults["beam_size"]), "temperature": 0.8},
        {**defaults, "beam_size": max(8, defaults["beam_size"]), "temperature": 0.6, "early_stopping": True},
    ]

    unique_presets = []
    seen = set()
    for preset in presets:
        key = tuple(sorted(preset.items()))
        if key in seen:
            continue
        seen.add(key)
        unique_presets.append(preset)

    return unique_presets


def decode_candidate(tensor, mask, runtime, preset):
    with runtime["torch"].inference_mode():
        hyp = runtime["model"].comer_model.beam_search(tensor, mask, **preset)[0]

    latex = runtime["vocab"].indices2label(hyp.seq)
    quality = assess_latex_quality(latex)
    return {
        "latex": latex,
        "normalized": quality["normalized"],
        "score": float(hyp.score),
        "issues": quality["issues"],
        "penalty": quality["penalty"],
    }


def choose_best_candidate(candidates):
    if not candidates:
        return None

    ranked = sorted(
        candidates,
        key=lambda candidate: (
            candidate["penalty"],
            -candidate["score"],
            len(candidate["normalized"]),
        ),
    )
    return ranked[0]


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def extract_base64_payload(image_data):
    if image_data.startswith("data:") and "," in image_data:
        return image_data.split(",", 1)[1]
    return image_data


def resize_to_model_limits(image):
    from PIL import Image as PILImage

    width, height = image.size
    resampling = getattr(PILImage, "Resampling", PILImage).BILINEAR

    scale_down = min(MAX_WIDTH / width, MAX_HEIGHT / height)
    if scale_down < 1:
        width = max(1, int(round(width * scale_down)))
        height = max(1, int(round(height * scale_down)))
        image = image.resize((width, height), resampling)

    width, height = image.size
    scale_up = max(MIN_WIDTH / width, MIN_HEIGHT / height)
    if scale_up > 1:
        width = max(1, int(round(width * scale_up)))
        height = max(1, int(round(height * scale_up)))
        image = image.resize((width, height), resampling)

    return image


def find_content_bbox(image):
    import cv2
    import numpy as np

    binary = np.array(image.point(lambda value: 255 if value < CONTENT_THRESHOLD else 0), dtype=np.uint8)
    if not np.any(binary):
        return None

    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if num_labels <= 1:
        return image.point(lambda value: 255 if value < CONTENT_THRESHOLD else 0).getbbox()

    components = []
    for label in range(1, num_labels):
        left = int(stats[label, cv2.CC_STAT_LEFT])
        top = int(stats[label, cv2.CC_STAT_TOP])
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        components.append(
            {
                "left": left,
                "top": top,
                "right": left + width,
                "bottom": top + height,
                "area": area,
            }
        )

    largest_area = max(component["area"] for component in components)
    significant_area = max(COMPONENT_MIN_AREA, int(round(largest_area * COMPONENT_MIN_AREA_RATIO)))
    nearby_area = max(COMPONENT_NEARBY_AREA, int(round(largest_area * COMPONENT_NEARBY_AREA_RATIO)))

    kept = [component for component in components if component["area"] >= significant_area]
    if not kept:
      kept = components[:1]

    changed = True
    while changed:
        changed = False
        union_left = min(component["left"] for component in kept)
        union_top = min(component["top"] for component in kept)
        union_right = max(component["right"] for component in kept)
        union_bottom = max(component["bottom"] for component in kept)

        expanded_left = union_left - COMPONENT_GAP_TOLERANCE
        expanded_top = union_top - COMPONENT_GAP_TOLERANCE
        expanded_right = union_right + COMPONENT_GAP_TOLERANCE
        expanded_bottom = union_bottom + COMPONENT_GAP_TOLERANCE

        for component in components:
            if component in kept or component["area"] < nearby_area:
                continue

            overlaps_expanded_union = not (
                component["right"] < expanded_left
                or component["left"] > expanded_right
                or component["bottom"] < expanded_top
                or component["top"] > expanded_bottom
            )

            if overlaps_expanded_union:
                kept.append(component)
                changed = True

    return (
        min(component["left"] for component in kept),
        min(component["top"] for component in kept),
        max(component["right"] for component in kept),
        max(component["bottom"] for component in kept),
    )


def preprocess_image(image_bytes, image_module):
    import numpy as np
    from PIL import ImageOps

    image = image_module.open(io.BytesIO(image_bytes)).convert("RGBA")
    background = image_module.new("RGBA", image.size, (255, 255, 255, 255))
    image = image_module.alpha_composite(background, image).convert("L")

    # CoMER is trained for dark strokes on a light background. If the exported
    # scene is mostly dark, treat it as a dark-theme canvas and invert it so the
    # handwriting becomes dark on white before cropping and inference.
    grayscale = np.array(image, dtype=np.uint8)
    dark_ratio = float((grayscale < CONTENT_THRESHOLD).mean())
    if dark_ratio > 0.5:
        image = ImageOps.invert(image)

    bbox = find_content_bbox(image)
    if bbox:
        left = max(0, bbox[0] - CONTENT_PADDING)
        top = max(0, bbox[1] - CONTENT_PADDING)
        right = min(image.size[0], bbox[2] + CONTENT_PADDING)
        bottom = min(image.size[1], bbox[3] + CONTENT_PADDING)
        image = image.crop((left, top, right, bottom))
    else:
        return None

    return resize_to_model_limits(image)


def resolve_device(torch_module):
    requested = os.environ.get("COMER_DEVICE", "").strip()
    if requested:
        return torch_module.device(requested)

    if torch_module.cuda.is_available():
        return torch_module.device("cuda")

    mps_backend = getattr(torch_module.backends, "mps", None)
    if mps_backend and torch_module.backends.mps.is_available():
        return torch_module.device("mps")

    return torch_module.device("cpu")


def load_runtime():
    import torch
    from PIL import Image
    from torchvision.transforms import ToTensor

    from comer.datamodule import vocab
    from comer.lit_comer import LitCoMER

    checkpoint_path = resolve_checkpoint_path()
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"CoMER checkpoint not found at {checkpoint_path}")

    device = resolve_device(torch)
    model = LitCoMER.load_from_checkpoint(str(checkpoint_path), map_location=device)
    model = model.eval().to(device)
    if hasattr(model, "freeze"):
        model.freeze()

    return {
        "torch": torch,
        "Image": Image,
        "ToTensor": ToTensor,
        "model": model,
        "vocab": vocab,
        "device": device,
        "checkpoint": str(checkpoint_path),
        "decode_presets": get_decode_presets(model),
    }


def recognize(image_data, runtime):
    image_bytes = base64.b64decode(extract_base64_payload(image_data))
    processed = preprocess_image(image_bytes, runtime["Image"])
    if processed is None:
        return {
            "latex": "",
            "normalized": "",
            "score": None,
            "imageSize": None,
            "device": str(runtime["device"]),
            "isReliable": False,
            "issues": ["no_content"],
        }

    tensor = runtime["ToTensor"]()(processed).unsqueeze(0).to(runtime["device"])
    mask = runtime["torch"].zeros(
        (1, tensor.shape[2], tensor.shape[3]),
        dtype=runtime["torch"].bool,
        device=runtime["device"],
    )

    candidates = [decode_candidate(tensor, mask, runtime, preset) for preset in runtime["decode_presets"]]
    best = choose_best_candidate(candidates)
    latex = best["latex"] if best else ""
    normalized = best["normalized"] if best else ""
    issues = best["issues"] if best else ["decode_failed"]

    if best and best["penalty"] >= 2:
        latex = ""
        normalized = ""

    return {
        "latex": latex,
        "normalized": normalized,
        "score": float(best["score"]) if best else None,
        "imageSize": {"width": processed.size[0], "height": processed.size[1]},
        "device": str(runtime["device"]),
        "isReliable": bool(best and best["penalty"] == 0),
        "issues": issues,
    }


def main():
    try:
        runtime = load_runtime()
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit({"event": "fatal", "error": f"CoMER startup failed: {exc}"})
        return 1

    emit(
        {
            "event": "ready",
            "checkpoint": runtime["checkpoint"],
            "device": str(runtime["device"]),
        }
    )

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id = None
        try:
            payload = json.loads(line)
            request_id = payload.get("id")
            image_data = payload.get("imageData", "")
            if not isinstance(image_data, str) or not image_data.strip():
                raise ValueError("Missing image payload.")

            result = recognize(image_data, runtime)
            emit({"id": request_id, "ok": True, **result})
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": f"CoMER recognition failed: {exc}",
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
