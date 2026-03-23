import fitz  # PyMuPDF
from PIL import Image
import io
import os
import tempfile
from typing import List, Dict, Optional, Tuple, Any
import numpy as np
from pythainlp.tokenize import word_tokenize
from difflib import SequenceMatcher
import imagehash
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer
import re
import pytesseract
from pdf2image import convert_from_path

from utils import to_ascii_id, l2norm, preprocess_text
from embedding import EmbeddingManager
from vector_db import VectorDBManager


class PDFProcessor:
    """Handle PDF processing including text extraction, image extraction, and similarity comparison"""

    def __init__(self, embedding_manager: EmbeddingManager):
        self.embedding_manager = embedding_manager
        self.raw_texts: Dict[str, str] = {}
        self.document_metadata: Dict[str, Dict] = {}

        # Image processing configuration
        self.MIN_IMG_AREA_RATIO = 0.05  # At least 5% of page area
        self.MIN_IMG_PIXELS = 64 * 64  # Or at least 64x64 pixels
        self.USE_PAGE_RENDER_FALLBACK = False  # Render full page as fallback

    def extract_text_from_pdf(self, pdf_path: str) -> str:
        """Extract text from PDF with OCR fallback"""
        try:
            doc = fitz.open(pdf_path)
            text = "\n".join([page.get_text("text") for page in doc]).strip()
            doc.close()

            # OCR fallback if no text found
            if not text:
                try:
                    print(f"  [INFO] No text found, attempting OCR for {pdf_path}")
                    images = convert_from_path(pdf_path)
                    ocr_text = [
                        pytesseract.image_to_string(img, lang="tha+eng")
                        for img in images
                    ]
                    text = "\n".join(ocr_text).strip()
                except Exception as e:
                    print(f"  [WARNING] OCR failed for {pdf_path}: {e}")
                    text = ""

            return text

        except Exception as e:
            print(f"  [ERROR] Text extraction failed for {pdf_path}: {e}")
            return ""

    def extract_template_text(self, template_path: str) -> str:
        """Extract text from template PDF"""
        return self.extract_text_from_pdf(template_path)

    def remove_template_text(
        self,
        student_text: str,
        template_text: str,
        threshold: float = 0.9,
        return_removed: bool = False,
    ) -> Tuple[str, str]:
        """Remove template text from student text"""
        if not template_text:
            if return_removed:
                return student_text, ""
            return student_text

        student_lines = student_text.strip().split("\n")
        template_lines = template_text.strip().split("\n")

        result = []
        removed = []

        for s_line in student_lines:
            match_found = any(
                SequenceMatcher(None, s_line.strip(), t_line.strip()).ratio()
                > threshold
                for t_line in template_lines
            )
            if not match_found:
                result.append(s_line)
            else:
                removed.append(s_line)

        clean_text = "\n".join(result).strip()
        removed_text = "\n".join(removed).strip()

        if return_removed:
            return clean_text, removed_text
        return clean_text

    def tokenize_thai_text(self, text: str) -> str:
        """Tokenize Thai text using PyThaiNLP"""
        try:
            tokens = word_tokenize(text, engine="newmm")
            return " ".join(tokens)
        except Exception as e:
            print(f"  [WARNING] Thai tokenization failed: {e}")
            return text

    def compute_phash_hex(self, pil_img: Image.Image) -> str:
        """Compute perceptual hash as hex string"""
        try:
            return str(imagehash.phash(pil_img))
        except Exception as e:
            print(f"  [WARNING] pHash computation failed: {e}")
            return ""

    def extract_images_from_pdf(self, pdf_path: str) -> List[Dict]:
        """Extract images from PDF with embeddings and pHash"""
        try:
            doc = fitz.open(pdf_path)
            images_to_embed = []

            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                page_area = page.rect.width * page.rect.height if page.rect else 0
                found_embedded = False

                # 1. Extract embedded images that meet size criteria
                if page_area > 0:
                    for img_info in page.get_images(full=True):
                        xref = img_info[0]
                        try:
                            bbox = page.get_image_bbox(img_info)
                            img_area = bbox.width * bbox.height
                        except Exception:
                            img_area = 0

                        take_this = False
                        if (
                            page_area > 0
                            and img_area > 0
                            and (img_area / page_area) >= self.MIN_IMG_AREA_RATIO
                        ):
                            take_this = True
                        else:
                            base_image = doc.extract_image(xref)
                            w = base_image.get("width", 0)
                            h = base_image.get("height", 0)
                            if (w * h) >= self.MIN_IMG_PIXELS:
                                take_this = True

                        if take_this:
                            try:
                                base_image = doc.extract_image(xref)
                                img_bytes = base_image["image"]
                                img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                                images_to_embed.append(img)
                                found_embedded = True
                            except Exception as e:
                                print(
                                    f"  [WARNING] Failed to extract image {xref}: {e}"
                                )

                # 2. Extract drawings if no embedded images
                if not found_embedded:
                    try:
                        total_drawings_bbox = fitz.Rect()
                        drawings = page.get_drawings()
                        for path in drawings:
                            total_drawings_bbox.include_rect(path["rect"])

                        if not total_drawings_bbox.is_empty and (
                            total_drawings_bbox.width > 20
                            and total_drawings_bbox.height > 20
                        ):
                            pix = page.get_pixmap(dpi=150, clip=total_drawings_bbox)
                            img = Image.frombytes(
                                "RGB", [pix.width, pix.height], pix.samples
                            )
                            images_to_embed.append(img)
                            found_embedded = True
                    except Exception as e:
                        print(
                            f"  [WARNING] Failed to extract drawings from page {page_num}: {e}"
                        )

                # 3. Fallback: render entire page
                if not found_embedded and self.USE_PAGE_RENDER_FALLBACK:
                    try:
                        pix = page.get_pixmap(dpi=150)
                        img = Image.frombytes(
                            "RGB", [pix.width, pix.height], pix.samples
                        )
                        images_to_embed.append(img)
                    except Exception as e:
                        print(f"  [WARNING] Failed to render page {page_num}: {e}")

            doc.close()

            # 4. Create embeddings and pHash for all images
            final_image_embeddings = []
            for i, img in enumerate(images_to_embed):
                try:
                    # Create CLIP embedding
                    img_embedding = self.embedding_manager.create_image_embedding(img)

                    # Create pHash
                    phash_hex = self.compute_phash_hex(img)

                    final_image_embeddings.append(
                        {"embedding": img_embedding, "phash_hex": phash_hex, "index": i}
                    )

                except Exception as e:
                    print(f"  [WARNING] Failed to create embedding for image {i}: {e}")

            return final_image_embeddings

        except Exception as e:
            print(f"  [ERROR] Image extraction failed for {pdf_path}: {e}")
            return []

    async def process_pdf(
        self,
        pdf_path: str,
        doc_id: str,
        processing_mode: int,
        user_id: str,
        batch_id: str,
        template_text: Optional[str] = None,
        vector_db: VectorDBManager = None,
    ) -> Dict[str, Any]:
        """Process a single PDF file based on processing mode"""
        if not doc_id:
            # กันพลาดเฉยๆ (optional)
            doc_id = to_ascii_id(os.path.basename(pdf_path).split(".")[0])

        print(f"\n--- Processing: {doc_id} (Mode {processing_mode}) ---")

        result = {
            "doc_id": doc_id,
            "status": "processed",
            "processing_mode": processing_mode,
        }

        try:
            # Mode 1: Text only
            if processing_mode == 1:
                print("  Mode: Text processing only")

                # Extract text
                student_text_raw = self.extract_text_from_pdf(pdf_path)

                # Remove template text if provided
                if template_text:
                    clean_text, removed_text = self.remove_template_text(
                        student_text_raw, template_text, return_removed=True
                    )
                    result["removed_text_length"] = len(removed_text)
                    print(f"  Removed template text: {len(removed_text)} characters")
                else:
                    clean_text = student_text_raw

                # Tokenize and create embedding
                tokenized_text = self.tokenize_thai_text(clean_text)
                text_embedding = self.embedding_manager.create_text_embedding(
                    tokenized_text
                )

                # Store in vector database
                if vector_db:
                    await vector_db.upsert_text_embedding(
                        doc_id,
                        text_embedding,
                        clean_text,
                        user_id=user_id,
                        batch_id=batch_id,
                    )

                # Store locally
                self.raw_texts[doc_id] = clean_text
                self.document_metadata[doc_id] = {
                    "text_length": len(clean_text),
                    "processing_mode": processing_mode,
                    "has_template": template_text is not None,
                }

                result["text_length"] = len(clean_text)
                print(f"  Text processing completed: {len(clean_text)} characters")

            # Mode 2: Images only
            elif processing_mode == 2:
                print("  Mode: Image processing only")

                # Extract images
                image_embeddings = self.extract_images_from_pdf(pdf_path)

                # Store in vector database
                if vector_db and image_embeddings:
                    await vector_db.upsert_image_embeddings(
                        doc_id, image_embeddings, user_id=user_id, batch_id=batch_id
                    )

                # Store metadata
                self.raw_texts[doc_id] = ""  # No text in image-only mode
                self.document_metadata[doc_id] = {
                    "image_count": len(image_embeddings),
                    "processing_mode": processing_mode,
                }

                result["image_count"] = len(image_embeddings)
                print(f"  Image processing completed: {len(image_embeddings)} images")

            # Mode 3: Both text and images
            elif processing_mode == 3:
                print("  Mode: Text and image processing")

                # Process text
                student_text_raw = self.extract_text_from_pdf(pdf_path)

                if template_text:
                    clean_text, removed_text = self.remove_template_text(
                        student_text_raw, template_text, return_removed=True
                    )
                    result["removed_text_length"] = len(removed_text)
                else:
                    clean_text = student_text_raw

                tokenized_text = self.tokenize_thai_text(clean_text)
                text_embedding = self.embedding_manager.create_text_embedding(
                    tokenized_text
                )

                # Process images
                image_embeddings = self.extract_images_from_pdf(pdf_path)

                # Store in vector database
                if vector_db:
                    await vector_db.upsert_text_embedding(
                        doc_id,
                        text_embedding,
                        clean_text,
                        user_id=user_id,
                        batch_id=batch_id,
                    )
                    if image_embeddings:
                        await vector_db.upsert_image_embeddings(
                            doc_id, image_embeddings, user_id=user_id, batch_id=batch_id
                        )

                # Store locally
                self.raw_texts[doc_id] = clean_text
                self.document_metadata[doc_id] = {
                    "text_length": len(clean_text),
                    "image_count": len(image_embeddings),
                    "processing_mode": processing_mode,
                    "has_template": template_text is not None,
                }

                result["text_length"] = len(clean_text)
                result["image_count"] = len(image_embeddings)
                print(
                    f"  Combined processing completed: {len(clean_text)} chars, {len(image_embeddings)} images"
                )

            return result

        except Exception as e:
            print(f"  [ERROR] Processing failed for {doc_id}: {e}")
            result["status"] = "error"
            result["error"] = str(e)
            return result

    def compute_text_similarity(
        self,
        text1: str,
        text2: str,
        emb1: np.ndarray,
        emb2: np.ndarray,
        alpha: float = 0.5,
        beta: float = 0.5,
    ) -> Tuple[float, float, float]:
        """Compute hybrid text similarity (semantic + lexical)"""
        try:
            # Semantic similarity
            semantic = cosine_similarity([emb1], [emb2])[0][0]

            # Lexical similarity
            t1_clean = preprocess_text(text1)
            t2_clean = preprocess_text(text2)

            if not t1_clean or not t2_clean:
                lexical = 0.0
            else:
                vectorizer = TfidfVectorizer(analyzer="word", ngram_range=(1, 3))
                try:
                    tfidf = vectorizer.fit_transform([t1_clean, t2_clean])
                    lexical = cosine_similarity(tfidf[0:1], tfidf[1:2])[0][0]
                except:
                    lexical = 0.0

            # Hybrid score
            hybrid = alpha * semantic + beta * lexical

            return hybrid, semantic, lexical

        except Exception as e:
            print(f"  [WARNING] Text similarity computation failed: {e}")
            return 0.0, 0.0, 0.0

    def compute_image_similarity(
        self,
        image_embeddings: Dict,
        image_hashes: Dict,
        doc_id_1: str,
        doc_id_2: str,
        w_emb: float = 0.7,
        w_ph: float = 0.3,
        phash_prefilter: float = 0.35,
        match_threshold: float = 0.80,
    ) -> Dict[str, Any]:
        """Compute image similarity between two documents"""
        try:
            from utils import phash_hamming_similarity

            keys1 = [k for k in image_embeddings if k.startswith(f"image_{doc_id_1}_")]
            keys2 = [k for k in image_embeddings if k.startswith(f"image_{doc_id_2}_")]

            if not keys1 or not keys2:
                return {
                    "cosine_avg": 0.0,
                    "phash_avg": 0.0,
                    "ensemble_avg": 0.0,
                    "matched_images": 0,
                    "total_pairs": 0,
                }

            cos_list, ph_list, ens_list = [], [], []
            matched = 0
            total_pairs = 0

            for k1 in keys1:
                for k2 in keys2:
                    ph1 = image_hashes.get(k1, "")
                    ph2 = image_hashes.get(k2, "")
                    phsim = phash_hamming_similarity(ph1, ph2) if (ph1 and ph2) else 0.0

                    # Prefilter with pHash
                    if phsim < phash_prefilter:
                        continue

                    cos = cosine_similarity(
                        [image_embeddings[k1]], [image_embeddings[k2]]
                    )[0][0]
                    ens = (w_emb * cos) + (w_ph * phsim)

                    cos_list.append(cos)
                    ph_list.append(phsim)
                    ens_list.append(ens)

                    total_pairs += 1
                    if ens >= match_threshold:
                        matched += 1

            if total_pairs == 0:
                return {
                    "cosine_avg": 0.0,
                    "phash_avg": 0.0,
                    "ensemble_avg": 0.0,
                    "matched_images": 0,
                    "total_pairs": 0,
                }

            return {
                "cosine_avg": float(np.mean(cos_list)),
                "phash_avg": float(np.mean(ph_list)),
                "ensemble_avg": float(np.mean(ens_list)),
                "matched_images": matched,
                "total_pairs": total_pairs,
            }

        except Exception as e:
            print(f"  [WARNING] Image similarity computation failed: {e}")
            return {
                "cosine_avg": 0.0,
                "phash_avg": 0.0,
                "ensemble_avg": 0.0,
                "matched_images": 0,
                "total_pairs": 0,
            }

    def compare_documents(
        self,
        doc_id_1: str,
        doc_id_2: str,
        text_embeddings: Dict,
        image_embeddings: Dict,
        image_hashes: Dict,
    ) -> Optional[Dict[str, Any]]:
        """Compare two documents and return similarity results"""
        try:
            # Get document metadata
            meta1 = self.document_metadata.get(doc_id_1, {})
            meta2 = self.document_metadata.get(doc_id_2, {})
            processing_mode = meta1.get("processing_mode", 3)  # Default to mixed mode

            result = {
                "doc_1": doc_id_1,
                "doc_2": doc_id_2,
                "processing_mode": processing_mode,
            }

            # Text similarity
            if processing_mode in [1, 3]:
                text_key_1 = f"text_{doc_id_1}"
                text_key_2 = f"text_{doc_id_2}"

                if text_key_1 in text_embeddings and text_key_2 in text_embeddings:
                    t1 = self.raw_texts.get(doc_id_1, "")
                    t2 = self.raw_texts.get(doc_id_2, "")
                    e1 = text_embeddings[text_key_1]
                    e2 = text_embeddings[text_key_2]

                    hybrid_sim, semantic_sim, lexical_sim = (
                        self.compute_text_similarity(t1, t2, e1, e2)
                    )

                    result.update(
                        {
                            "text_similarity": float(hybrid_sim),
                            "semantic_similarity": float(semantic_sim),
                            "lexical_similarity": float(lexical_sim),
                        }
                    )
                else:
                    result.update(
                        {
                            "text_similarity": 0.0,
                            "semantic_similarity": 0.0,
                            "lexical_similarity": 0.0,
                        }
                    )
            else:
                result.update(
                    {
                        "text_similarity": 0.0,
                        "semantic_similarity": 0.0,
                        "lexical_similarity": 0.0,
                    }
                )

            # Image similarity
            if processing_mode in [2, 3]:
                image_comp = self.compute_image_similarity(
                    image_embeddings, image_hashes, doc_id_1, doc_id_2
                )
                result.update(
                    {
                        "image_similarity": image_comp["ensemble_avg"],
                        "image_cosine_avg": image_comp["cosine_avg"],
                        "image_phash_avg": image_comp["phash_avg"],
                        "matched_images": image_comp["matched_images"],
                        "total_images": image_comp["total_pairs"],
                    }
                )
            else:
                result.update(
                    {
                        "image_similarity": 0.0,
                        "image_cosine_avg": 0.0,
                        "image_phash_avg": 0.0,
                        "matched_images": 0,
                        "total_images": 0,
                    }
                )

            # Combined score based on processing mode
            if processing_mode == 1:
                combined_score = result["text_similarity"]
            elif processing_mode == 2:
                combined_score = result["image_similarity"]
            else:  # processing_mode == 3
                text_weight = 0.5
                image_weight = 0.5
                combined_score = (text_weight * result["text_similarity"]) + (
                    image_weight * result["image_similarity"]
                )

            result["combined_score"] = float(combined_score)

            # Determine similarity level
            if combined_score >= 0.85:
                level = "คล้ายระดับสูง"
            elif combined_score >= 0.80:
                level = "คล้ายระดับกลาง"
            else:
                level = "คล้ายระดับต่ำ"

            result["level"] = level

            return result

        except Exception as e:
            print(
                f"  [ERROR] Document comparison failed for {doc_id_1} vs {doc_id_2}: {e}"
            )
            return None

    def get_document_ids(self) -> List[str]:
        """Get all processed document IDs"""
        return list(self.raw_texts.keys())

    def has_document(self, doc_id: str) -> bool:
        """Check if document exists"""
        return doc_id in self.raw_texts

    def get_document_info(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Get document information"""
        if doc_id not in self.raw_texts:
            return None

        info = {"doc_id": doc_id, "text_length": len(self.raw_texts[doc_id])}

        if doc_id in self.document_metadata:
            info.update(self.document_metadata[doc_id])

        return info

    def remove_document(self, doc_id: str) -> bool:
        """Remove a document from processor"""
        try:
            if doc_id in self.raw_texts:
                del self.raw_texts[doc_id]
            if doc_id in self.document_metadata:
                del self.document_metadata[doc_id]
            return True
        except Exception as e:
            print(f"  [ERROR] Failed to remove document {doc_id}: {e}")
            return False

    def clear_all_documents(self):
        """Clear all processed documents"""
        self.raw_texts.clear()
        self.document_metadata.clear()
