import base64
import io
import json
import os
import sys
import traceback
from pathlib import Path

import torch
from PIL import Image, ImageOps
import cv2
import numpy as np

# Add CoMER to path
ROOT = Path(__file__).resolve().parents[1]
COMER_DIR = ROOT / "CoMER"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(COMER_DIR) not in sys.path:
    sys.path.insert(0, str(COMER_DIR))

from comer.lit_comer import LitCoMER
from comer.datamodule import vocab

# Configuration
MIN_WIDTH = 16
MIN_HEIGHT = 16
MAX_WIDTH = 1024
MAX_HEIGHT = 256
CONTENT_THRESHOLD = 245
CONTENT_PADDING = 16


def emit(payload):
    """Emit JSON payload to stdout for parent process to read"""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def extract_base64_payload(image_data):
    """Extract base64 data from data URI"""
    if image_data.startswith("data:") and "," in image_data:
        return image_data.split(",", 1)[1]
    return image_data


def resize_to_model_limits(image):
    """Resize image to fit model input constraints"""
    width, height = image.size
    resampling = getattr(Image, "Resampling", Image).BILINEAR

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
    """Find bounding box of content in image"""
    binary = np.array(
        image.point(lambda value: 255 if value < CONTENT_THRESHOLD else 0),
        dtype=np.uint8,
    )
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
        components.append({
            "left": left,
            "top": top,
            "right": left + width,
            "bottom": top + height,
            "area": area,
        })

    if not components:
        return None

    largest_area = max(component["area"] for component in components)
    significant_area = max(16, int(round(largest_area * 0.025)))

    kept = [component for component in components if component["area"] >= significant_area]
    if not kept:
        kept = components[:1]

    return (
        min(component["left"] for component in kept),
        min(component["top"] for component in kept),
        max(component["right"] for component in kept),
        max(component["bottom"] for component in kept),
    )


def preprocess_image(image_bytes):
    """Preprocess image for CoMER model"""
    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    background = Image.new("RGBA", image.size, (255, 255, 255, 255))
    image = Image.alpha_composite(background, image).convert("L")

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
    image = Image.fromarray(binary, mode="L")

    return resize_to_model_limits(image)


def load_runtime():
    """Load CoMER model and return runtime context"""
    device_str = os.environ.get("COMER_DEVICE", "").strip() or "cpu"  # Default to CPU
    model_path = os.environ.get("COMER_MODEL_PATH", "").strip()
    
    if not model_path:
        # Default to best model
        model_path = str(ROOT / "CoMER/lightning_logs/version_0/checkpoints/epoch=151-step=57151-val_ExpRate=0.6365.ckpt")
    
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model checkpoint not found: {model_path}")
    
    # Determine device - force CPU to avoid driver issues
    device = torch.device(device_str)
    
    # Load model with map_location and weights_only=False for pytorch-lightning compatibility
    try:
        model = LitCoMER.load_from_checkpoint(
            model_path, 
            map_location=str(device),
            weights_only=False  # Required for pytorch-lightning checkpoints
        )
    except TypeError:
        # Fallback for older pytorch-lightning versions without weights_only parameter
        model = LitCoMER.load_from_checkpoint(model_path, map_location=str(device))
    
    model = model.to(device)
    model.eval()
    
    return {
        "model": model,
        "device": device,
        "model_path": model_path,
    }


def normalize_template(img):
    """Normalize image to standard format for CoMER"""
    img = np.array(img, dtype=np.float32)
    img = img / 255.0
    return torch.from_numpy(img).unsqueeze(0).unsqueeze(0)  # [1, 1, H, W]


@torch.no_grad()
def recognize(image_data, runtime):
    """Recognize formula from image using CoMER"""
    try:
        # Decode image
        image_bytes = base64.b64decode(extract_base64_payload(image_data))
        
        # Preprocess
        processed = preprocess_image(image_bytes)
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
        
        # Normalize image tensor
        img_tensor = normalize_template(processed)
        img_tensor = img_tensor.to(runtime["device"])
        
        # Create mask (all ones since we don't have partial images)
        img_mask = torch.ones(1, img_tensor.shape[2], img_tensor.shape[3], dtype=torch.long, device=runtime["device"])
        
        # Run model inference
        model = runtime["model"]
        
        # Get beam search predictions
        hyps = model.approximate_joint_search(img_tensor, img_mask)
        
        if hyps and len(hyps) > 0:
            # Use best hypothesis
            best_hyp = hyps[0]
            predicted_seq = best_hyp.seq
            predicted_latex = vocab.indices2label(predicted_seq)
        else:
            predicted_latex = ""
        
        # Normalize latex
        normalized = " ".join(str(predicted_latex or "").split())
        
        return {
            "latex": predicted_latex,
            "normalized": normalized,
            "score": float(hyps[0].score) if hyps and hyps[0].score is not None else None,
            "imageSize": processed.size,
            "device": str(runtime["device"]),
            "isReliable": len(predicted_latex) > 0,
            "issues": [] if predicted_latex else ["empty_result"],
        }
    
    except Exception as e:
        return {
            "latex": "",
            "normalized": "",
            "score": None,
            "imageSize": None,
            "device": str(runtime["device"]),
            "isReliable": False,
            "issues": ["recognition_error"],
            "error": str(e),
        }


def main():
    """Main worker loop"""
    try:
        # Load model
        runtime = load_runtime()
        device_str = str(runtime["device"])
        model_name = os.path.basename(runtime["model_path"])
        
        # Signal ready
        emit({
            "event": "ready",
            "device": device_str,
            "model": model_name,
        })
        
        # Process requests
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            
            try:
                request = json.loads(line.strip())
                request_id = request.get("id")
                image_data = request.get("imageData", "")
                
                result = recognize(image_data, runtime)
                
                emit({
                    "id": request_id,
                    "success": True,
                    "result": result,
                })
            
            except json.JSONDecodeError:
                continue
            except Exception as e:
                emit({
                    "id": request.get("id") if 'request' in locals() else None,
                    "success": False,
                    "error": str(e),
                })
    
    except Exception as e:
        emit({"event": "error", "error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
