import os
import re
import shutil
import tempfile
import numpy as np
from typing import List
from slugify import slugify
from pythainlp.tokenize import word_tokenize
from fastapi import UploadFile, HTTPException
import imagehash
from PIL import Image


def l2norm(x: np.ndarray) -> np.ndarray:
    """L2 normalize a vector"""
    try:
        n = np.linalg.norm(x)
        if n == 0:
            return x
        return x / (n + 1e-12)
    except Exception as e:
        print(f"⚠️ Warning: L2 normalization failed: {e}")
        return x


def to_ascii_id(filename: str) -> str:
    """Convert filename to ASCII ID using slugify"""
    try:
        # Remove file extension and convert to slug
        name = os.path.splitext(filename)[0]
        return slugify(name, separator="_")
    except Exception as e:
        print(f"⚠️ Warning: ASCII ID conversion failed for {filename}: {e}")
        return filename.replace(" ", "_")


def preprocess_text(text: str) -> str:
    """Preprocess text for similarity comparison"""
    try:
        if not text or not text.strip():
            return ""

        # Remove punctuation and extra spaces
        text = re.sub(r"[^\w\s]", "", text)
        text = re.sub(r"\s+", " ", text).strip()

        # Tokenize Thai text
        tokens = word_tokenize(text, engine="newmm")
        return " ".join(tokens)

    except Exception as e:
        print(f"⚠️ Warning: Text preprocessing failed: {e}")
        return text


def validate_pdf_files(files: List[UploadFile]) -> None:
    """Validate that all uploaded files are PDFs"""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    for file in files:
        if not file.filename:
            raise HTTPException(status_code=400, detail="File must have a filename")

        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"File '{file.filename}' is not a PDF. Only PDF files are supported.",
            )

        # Check file size (limit to 50MB per file)
        if hasattr(file, "size") and file.size and file.size > 50 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"File '{file.filename}' is too large. Maximum size is 50MB.",
            )


def cleanup_temp_dir(temp_dir: str) -> None:
    """Safely clean up temporary directory"""
    try:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            print(f"🧹 Cleaned up temporary directory: {temp_dir}")
    except Exception as e:
        print(f"⚠️ Warning: Failed to clean up temporary directory {temp_dir}: {e}")


def create_temp_dir(prefix: str = "pdf_processing_") -> str:
    """Create a temporary directory"""
    try:
        temp_dir = tempfile.mkdtemp(prefix=prefix)
        print(f"📁 Created temporary directory: {temp_dir}")
        return temp_dir
    except Exception as e:
        print(f"❌ Error creating temporary directory: {e}")
        raise e


def safe_file_write(file_path: str, data: bytes) -> bool:
    """Safely write binary data to file"""
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        print(f"❌ Error writing file {file_path}: {e}")
        return False


def safe_file_read(file_path: str, mode: str = "rb") -> bytes:
    """Safely read file contents"""
    try:
        with open(file_path, mode) as f:
            return f.read()
    except Exception as e:
        print(f"❌ Error reading file {file_path}: {e}")
        return b"" if "b" in mode else ""


def phash_hamming_similarity(hex1: str, hex2: str) -> float:
    """Calculate pHash similarity using Hamming distance"""
    try:
        if not hex1 or not hex2:
            return 0.0

        h1 = imagehash.hex_to_hash(hex1)
        h2 = imagehash.hex_to_hash(hex2)

        hamming_distance = h1 - h2  # Hamming distance
        max_distance = h1.hash.size  # Usually 64 for pHash

        # Convert distance to similarity (1 = identical, 0 = completely different)
        similarity = 1.0 - (hamming_distance / max_distance)
        return float(similarity)

    except Exception as e:
        print(f"⚠️ Warning: pHash similarity calculation failed: {e}")
        return 0.0


def compute_phash_hex(pil_img: Image.Image) -> str:
    """Compute perceptual hash and return as hex string"""
    try:
        if not isinstance(pil_img, Image.Image):
            return ""

        return str(imagehash.phash(pil_img))

    except Exception as e:
        print(f"⚠️ Warning: pHash computation failed: {e}")
        return ""


def validate_image_format(image: Image.Image) -> Image.Image:
    """Ensure image is in RGB format"""
    try:
        if image.mode != "RGB":
            return image.convert("RGB")
        return image
    except Exception as e:
        print(f"⚠️ Warning: Image format validation failed: {e}")
        return image


def get_file_size_mb(file_path: str) -> float:
    """Get file size in MB"""
    try:
        size_bytes = os.path.getsize(file_path)
        return size_bytes / (1024 * 1024)
    except Exception as e:
        print(f"⚠️ Warning: Could not get file size for {file_path}: {e}")
        return 0.0


def format_similarity_score(score: float, decimal_places: int = 4) -> str:
    """Format similarity score for display"""
    try:
        return f"{score:.{decimal_places}f}"
    except Exception:
        return "0.0000"


def get_similarity_level_thai(score: float) -> str:
    if score >= 0.85:
        return "คล้ายระดับสูง"
    elif score >= 0.80:
        return "คล้ายระดับกลาง"
    else:
        return "คล้ายระดับต่ำ"


def get_similarity_level_color(level: str) -> str:
    """Get color code for similarity level"""
    color_map = {
        "คล้ายระดับสูง": "#ef4444",
        "คล้ายระดับกลาง": "#f97316",
        "คล้ายระดับต่ำ": "#22c55e",
    }
    return color_map.get(level, "#6b7280")


def batch_process_items(items: List, batch_size: int = 32):
    """Generator to process items in batches"""
    for i in range(0, len(items), batch_size):
        yield items[i : i + batch_size]


def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Safely divide two numbers, return default if division by zero"""
    try:
        if denominator == 0:
            return default
        return numerator / denominator
    except Exception:
        return default


def ensure_directory_exists(directory_path: str) -> bool:
    """Ensure directory exists, create if it doesn't"""
    try:
        os.makedirs(directory_path, exist_ok=True)
        return True
    except Exception as e:
        print(f"❌ Error creating directory {directory_path}: {e}")
        return False


def log_processing_info(doc_id: str, processing_mode: int, **kwargs):
    """Log processing information"""
    mode_names = {1: "Text Only", 2: "Images Only", 3: "Text + Images"}
    mode_name = mode_names.get(processing_mode, "Unknown")

    print(f"📄 Processing {doc_id} - Mode: {mode_name}")

    for key, value in kwargs.items():
        if isinstance(value, (int, float)):
            print(f"   {key}: {value}")
        else:
            print(f"   {key}: {str(value)[:100]}...")


def calculate_weighted_similarity(
    similarities: List[float], weights: List[float] = None
) -> float:
    """Calculate weighted average of similarities"""
    try:
        if not similarities:
            return 0.0

        if not weights:
            return float(np.mean(similarities))

        if len(similarities) != len(weights):
            print(
                "⚠️ Warning: Similarities and weights length mismatch, using equal weights"
            )
            return float(np.mean(similarities))

        weighted_sum = sum(s * w for s, w in zip(similarities, weights))
        total_weight = sum(weights)

        return safe_divide(weighted_sum, total_weight, 0.0)

    except Exception as e:
        print(f"⚠️ Warning: Weighted similarity calculation failed: {e}")
        return 0.0


def truncate_text(text: str, max_length: int = 200, suffix: str = "...") -> str:
    """Truncate text to specified length"""
    if not text or len(text) <= max_length:
        return text

    return text[: max_length - len(suffix)] + suffix


def get_memory_usage() -> dict:
    """Get current memory usage information"""
    try:
        import psutil

        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()

        return {
            "rss_mb": memory_info.rss / 1024 / 1024,  # Resident Set Size
            "vms_mb": memory_info.vms / 1024 / 1024,  # Virtual Memory Size
            "cpu_percent": process.cpu_percent(),
        }
    except ImportError:
        return {"error": "psutil not available"}
    except Exception as e:
        return {"error": str(e)}


def validate_numpy_array(arr: np.ndarray, expected_shape: tuple = None) -> bool:
    """Validate numpy array properties"""
    try:
        if not isinstance(arr, np.ndarray):
            return False

        if expected_shape and arr.shape != expected_shape:
            return False

        # Check for NaN or infinity values
        if np.any(np.isnan(arr)) or np.any(np.isinf(arr)):
            return False

        return True

    except Exception:
        return False


def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe file system operations"""
    try:
        # Remove or replace problematic characters
        sanitized = re.sub(r'[<>:"/\\|?*]', "_", filename)
        sanitized = re.sub(r"[^\w\s\-_\.]", "", sanitized)
        sanitized = sanitized.strip()

        # Ensure filename is not empty or too long
        if not sanitized:
            sanitized = "unnamed_file"

        if len(sanitized) > 255:
            name, ext = os.path.splitext(sanitized)
            sanitized = name[:250] + ext

        return sanitized

    except Exception as e:
        print(f"⚠️ Warning: Filename sanitization failed for '{filename}': {e}")
        return "sanitized_filename"
