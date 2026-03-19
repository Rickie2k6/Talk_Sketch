import base64
import io
import json
import os
import sys
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

CHECKPOINT_PATH = Path(
    os.environ.get(
        "COMER_CHECKPOINT",
        ROOT / "lightning_logs" / "version_0" / "checkpoints" / "epoch=151-step=57151-val_ExpRate=0.6365.ckpt",
    )
)
MIN_WIDTH = 16
MIN_HEIGHT = 16
MAX_WIDTH = 1024
MAX_HEIGHT = 256
CONTENT_THRESHOLD = 245
CONTENT_PADDING = 16


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


def preprocess_image(image_bytes, image_module):
    image = image_module.open(io.BytesIO(image_bytes)).convert("RGBA")
    background = image_module.new("RGBA", image.size, (255, 255, 255, 255))
    image = image_module.alpha_composite(background, image).convert("L")

    mask = image.point(lambda value: 255 if value < CONTENT_THRESHOLD else 0)
    bbox = mask.getbbox()
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

    if not CHECKPOINT_PATH.exists():
        raise FileNotFoundError(f"CoMER checkpoint not found at {CHECKPOINT_PATH}")

    device = resolve_device(torch)
    model = LitCoMER.load_from_checkpoint(str(CHECKPOINT_PATH), map_location=device)
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
        "checkpoint": str(CHECKPOINT_PATH),
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
        }

    tensor = runtime["ToTensor"]()(processed).unsqueeze(0).to(runtime["device"])
    mask = runtime["torch"].zeros(
        (1, tensor.shape[2], tensor.shape[3]),
        dtype=runtime["torch"].bool,
        device=runtime["device"],
    )

    with runtime["torch"].inference_mode():
        hyp = runtime["model"].approximate_joint_search(tensor, mask)[0]

    latex = runtime["vocab"].indices2label(hyp.seq)

    return {
        "latex": latex,
        "normalized": " ".join(latex.split()),
        "score": float(hyp.score),
        "imageSize": {"width": processed.size[0], "height": processed.size[1]},
        "device": str(runtime["device"]),
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
