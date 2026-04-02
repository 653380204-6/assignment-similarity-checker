import torch
import numpy as np
from PIL import Image
from typing import Optional, Union
from sentence_transformers import SentenceTransformer
from transformers import CLIPModel, CLIPProcessor
import asyncio
import os
from pathlib import Path
from utils import l2norm


class EmbeddingManager:
    """Manage text and image embedding models"""

    def __init__(self):
        self.cache_dir = os.getenv(
            "HF_HOME", str(Path.home() / ".cache" / "huggingface")
        )  # เพิ่มมาใหม่

        self.labse_model: Optional[SentenceTransformer] = None
        self.clip_model: Optional[CLIPModel] = None
        self.clip_processor: Optional[CLIPProcessor] = None
        self._initialized = False
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

        print(f"Using device: {self._device}")

    async def initialize(self):
        if self._initialized:
            return

        try:
            print("Loading LaBSE model for text embeddings")
            self.labse_model = SentenceTransformer(
                "sentence-transformers/LaBSE",
                cache_folder=self.cache_dir,
                device=self._device,
            )

            print("Loading CLIP model for image embeddings")
            self.clip_model = CLIPModel.from_pretrained(
                "openai/clip-vit-large-patch14",
                cache_dir=self.cache_dir,
            ).to(self._device)

            self.clip_model.eval()

            self.clip_processor = CLIPProcessor.from_pretrained(
                "openai/clip-vit-large-patch14",
                cache_dir=self.cache_dir,
                use_fast=True,
            )

            await self._warmup_models()

            self._initialized = True
            print("All embedding models loaded successfully!")

        except Exception as e:
            print(f"Error initializing embedding models: {e}")
            raise e

    async def _warmup_models(self):
        """Warm up models with dummy inputs for better performance"""
        try:
            print("Warming up models")

            # Warm up LaBSE
            if self.labse_model:
                dummy_text = "สวัสดี hello world"
                _ = self.labse_model.encode(dummy_text)

            # Warm up CLIP
            if self.clip_model and self.clip_processor:
                dummy_image = Image.new("RGB", (224, 224), color="white")
                inputs = self.clip_processor(images=dummy_image, return_tensors="pt")
                inputs = {k: v.to(self._device) for k, v in inputs.items()}
                with torch.no_grad():
                    _ = self.clip_model.get_image_features(**inputs)

            print("Model warmup completed!")

        except Exception as e:
            print(f"Warning: Model warmup failed: {e}")

    def is_ready(self) -> bool:
        """Check if all models are initialized and ready"""
        return (
            self._initialized
            and self.labse_model is not None
            and self.clip_model is not None
            and self.clip_processor is not None
        )

    def create_text_embedding(self, text: str) -> np.ndarray:
        """Create text embedding using LaBSE model"""
        if not self.is_ready():
            raise RuntimeError("Embedding models not initialized")

        if not text or not text.strip():
            # Return zero vector for empty text
            return np.zeros(768, dtype=np.float32)

        try:
            # Generate embedding
            embedding = self.labse_model.encode(
                text,
                convert_to_numpy=True,
                device=self._device,
                show_progress_bar=False,
            )

            # Convert to numpy array and normalize
            if isinstance(embedding, list):
                embedding = np.array(embedding, dtype=np.float32)
            else:
                embedding = np.asarray(embedding, dtype=np.float32)

            # L2 normalize
            embedding = l2norm(embedding)

            return embedding

        except Exception as e:
            print(f"Error creating text embedding: {e}")
            # Return zero vector on error
            return np.zeros(768, dtype=np.float32)

    def create_image_embedding(self, image: Union[Image.Image, str]) -> np.ndarray:
        """Create image embedding using CLIP model"""
        if not self.is_ready():
            raise RuntimeError("Embedding models not initialized")

        try:
            # Handle different image input types
            if isinstance(image, str):
                image = Image.open(image).convert("RGB")
            elif not isinstance(image, Image.Image):
                raise ValueError("Image must be PIL Image or file path")

            # Ensure image is RGB
            if image.mode != "RGB":
                image = image.convert("RGB")

            # Process image and create embedding
            inputs = self.clip_processor(images=image, return_tensors="pt")
            inputs = {k: v.to(self._device) for k, v in inputs.items()}

            with torch.no_grad():
                image_features = self.clip_model.get_image_features(**inputs)

            # Convert to numpy and normalize
            embedding = image_features.squeeze(0).cpu().numpy().astype(np.float32)
            embedding = l2norm(embedding)

            return embedding

        except Exception as e:
            print(f"❌ Error creating image embedding: {e}")
            return np.zeros(512, dtype=np.float32)

    def create_batch_text_embeddings(self, texts: list) -> np.ndarray:
        """Create embeddings for multiple texts efficiently"""
        if not self.is_ready():
            raise RuntimeError("Embedding models not initialized")

        if not texts:
            return np.array([])

        try:
            # Filter out empty texts
            non_empty_texts = [text for text in texts if text and text.strip()]

            if not non_empty_texts:
                return np.zeros((len(texts), 768), dtype=np.float32)

            # Create embeddings in batch
            embeddings = self.labse_model.encode(
                non_empty_texts,
                batch_size=32,
                show_progress_bar=False,
                convert_to_numpy=True,
                device=self._device,
            )
            embeddings = np.asarray(embeddings, dtype=np.float32)

            # L2 normalize all embeddings
            normalized_embeddings = np.array([l2norm(emb) for emb in embeddings])

            # Handle empty texts by inserting zero vectors at correct positions
            final_embeddings = []
            non_empty_idx = 0

            for text in texts:
                if text and text.strip():
                    final_embeddings.append(normalized_embeddings[non_empty_idx])
                    non_empty_idx += 1
                else:
                    final_embeddings.append(np.zeros(768, dtype=np.float32))

            return np.array(final_embeddings)

        except Exception as e:
            print(f"❌ Error creating batch text embeddings: {e}")
            return np.zeros((len(texts), 768), dtype=np.float32)

    def create_batch_image_embeddings(self, images: list) -> np.ndarray:
        """Create embeddings for multiple images efficiently"""
        if not self.is_ready():
            raise RuntimeError("Embedding models not initialized")

        if not images:
            return np.array([])

        try:
            # Process all images
            processed_images = []
            for img in images:
                if isinstance(img, str):
                    img = Image.open(img).convert("RGB")
                elif isinstance(img, Image.Image):
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    processed_images.append(img)
                else:
                    # Skip invalid images, add placeholder
                    processed_images.append(None)

            # Create embeddings for valid images
            valid_images = [img for img in processed_images if img is not None]

            if not valid_images:
                return np.zeros((len(images), 512), dtype=np.float32)

            # Process in batches
            batch_size = 16
            all_embeddings = []

            for i in range(0, len(valid_images), batch_size):
                batch = valid_images[i : i + batch_size]
                inputs = self.clip_processor(
                    images=batch, return_tensors="pt", padding=True
                )
                inputs = {k: v.to(self._device) for k, v in inputs.items()}

                with torch.no_grad():
                    batch_features = self.clip_model.get_image_features(**inputs)

                batch_embeddings = batch_features.cpu().numpy().astype(np.float32)
                all_embeddings.append(batch_embeddings)

            # Combine all batches
            embeddings = np.vstack(all_embeddings) if all_embeddings else np.array([])

            # L2 normalize
            normalized_embeddings = np.array([l2norm(emb) for emb in embeddings])

            # Handle None images by inserting zero vectors
            final_embeddings = []
            valid_idx = 0

            for img in processed_images:
                if img is not None:
                    final_embeddings.append(normalized_embeddings[valid_idx])
                    valid_idx += 1
                else:
                    final_embeddings.append(np.zeros(512, dtype=np.float32))

            return np.array(final_embeddings)

        except Exception as e:
            print(f"❌ Error creating batch image embeddings: {e}")
            return np.zeros((len(images), 512), dtype=np.float32)

    def get_text_embedding_dimension(self) -> int:
        """Get text embedding dimension"""
        return 768  # LaBSE dimension

    def get_image_embedding_dimension(self) -> int:
        """Get image embedding dimension"""
        return 512  # CLIP ViT-B/32 dimension

    def compute_text_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """Compute cosine similarity between text embeddings"""
        try:
            from sklearn.metrics.pairwise import cosine_similarity

            return float(cosine_similarity([emb1], [emb2])[0][0])
        except Exception as e:
            print(f"❌ Error computing text similarity: {e}")
            return 0.0

    def compute_image_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """Compute cosine similarity between image embeddings"""
        try:
            from sklearn.metrics.pairwise import cosine_similarity

            return float(cosine_similarity([emb1], [emb2])[0][0])
        except Exception as e:
            print(f"❌ Error computing image similarity: {e}")
            return 0.0

    def cleanup(self):
        """Clean up models and free memory"""
        try:
            if self.labse_model:
                del self.labse_model
                self.labse_model = None

            if self.clip_model:
                del self.clip_model
                self.clip_model = None

            if self.clip_processor:
                del self.clip_processor
                self.clip_processor = None

            # Clear CUDA cache if using GPU
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            self._initialized = False
            print("🧹 Embedding models cleaned up successfully")

        except Exception as e:
            print(f"⚠️ Warning: Error during cleanup: {e}")

    def get_model_info(self) -> dict:
        """Get information about loaded models"""
        return {
            "initialized": self._initialized,
            "device": self._device,
            "text_model": "sentence-transformers/LaBSE" if self.labse_model else None,
            "image_model": "openai/clip-vit-base-patch32" if self.clip_model else None,
            "text_dimension": (
                self.get_text_embedding_dimension() if self.is_ready() else None
            ),
            "image_dimension": (
                self.get_image_embedding_dimension() if self.is_ready() else None
            ),
        }
