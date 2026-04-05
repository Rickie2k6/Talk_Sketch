import base64
import io
import json
import os
import sys
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDORED_PIX2TEXT_DIR = ROOT / "Pix2Text"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if VENDORED_PIX2TEXT_DIR.exists() and str(VENDORED_PIX2TEXT_DIR) not in sys.path:
    sys.path.insert(0, str(VENDORED_PIX2TEXT_DIR))

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
    import cv2
    import numpy as np
    from PIL import ImageOps

    image = image_module.open(io.BytesIO(image_bytes)).convert("RGBA")
    background = image_module.new("RGBA", image.size, (255, 255, 255, 255))
    image = image_module.alpha_composite(background, image).convert("L")

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

    image = ImageOps.autocontrast(image)
    image_array = np.array(image, dtype=np.uint8)
    _, binary = cv2.threshold(image_array, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    if binary.mean() < 127:
        binary = 255 - binary

    kernel = np.ones((2, 2), dtype=np.uint8)
    ink_mask = cv2.bitwise_not(binary)
    ink_mask = cv2.dilate(ink_mask, kernel, iterations=1)
    binary = cv2.bitwise_not(ink_mask)
    image = image_module.fromarray(binary, mode="L")

    return resize_to_model_limits(image)


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


def load_runtime():
    from PIL import Image
    from pix2text import LatexOCR

    model_name = os.environ.get("PIX2TEXT_MODEL_NAME", "mfr-1.5").strip() or "mfr-1.5"
    model_backend = os.environ.get("PIX2TEXT_MODEL_BACKEND", "onnx").strip() or "onnx"
    requested_device = os.environ.get("PIX2TEXT_DEVICE", "").strip() or None
    model_dir = os.environ.get("PIX2TEXT_MODEL_DIR", "").strip() or None
    model_root = os.environ.get("PIX2TEXT_ROOT", "").strip() or None
    provider = os.environ.get("PIX2TEXT_PROVIDER", "").strip() or None
    rec_config_raw = os.environ.get("PIX2TEXT_REC_CONFIG", "").strip()

    rec_config = {}
    if rec_config_raw:
        rec_config = json.loads(rec_config_raw)

    more_model_configs = {}
    if provider:
        more_model_configs["provider"] = provider
    elif model_backend == "onnx" and requested_device:
        lowered = requested_device.lower()
        if lowered.startswith("cuda") or lowered == "gpu":
            more_model_configs["provider"] = "CUDAExecutionProvider"
        elif lowered == "cpu":
            more_model_configs["provider"] = "CPUExecutionProvider"

    engine_kwargs = {
        "model_name": model_name,
        "model_backend": model_backend,
    }
    if requested_device:
        engine_kwargs["device"] = requested_device
    if model_dir:
        engine_kwargs["model_dir"] = model_dir
    if model_root:
        engine_kwargs["root"] = model_root
    if more_model_configs:
        engine_kwargs["more_model_configs"] = more_model_configs

    engine = LatexOCR(**engine_kwargs)
    runtime_device = str(getattr(engine, "device", requested_device or "auto"))

    return {
        "Image": Image,
        "engine": engine,
        "rec_config": rec_config,
        "device": runtime_device,
        "model": f"{model_name} ({model_backend})",
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
            "device": runtime["device"],
            "isReliable": False,
            "issues": ["no_content"],
        }

    result = runtime["engine"].recognize(
        processed,
        batch_size=1,
        rec_config=runtime["rec_config"],
        use_post_process=True,
    )
    latex = result.get("text", "").strip() if isinstance(result, dict) else str(result or "").strip()
    quality = assess_latex_quality(latex)
    normalized = quality["normalized"]
    issues = quality["issues"]
    is_reliable = quality["penalty"] == 0

    if quality["penalty"] >= 2:
        latex = ""
        normalized = ""

    return {
        "latex": latex,
        "normalized": normalized,
        "score": float(result.get("score")) if isinstance(result, dict) and result.get("score") is not None else None,
        "imageSize": {"width": processed.size[0], "height": processed.size[1]},
        "device": runtime["device"],
        "isReliable": is_reliable,
        "issues": issues,
    }


def main():
    try:
        runtime = load_runtime()
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit({"event": "fatal", "error": f"Pix2Text startup failed: {exc}"})
        return 1

    emit(
        {
            "event": "ready",
            "model": runtime["model"],
            "device": runtime["device"],
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
                    "error": f"Pix2Text recognition failed: {exc}",
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
