import os
import numpy as np
from typing import Dict, List, Optional, Any, Tuple
from pinecone import Pinecone, ServerlessSpec
import asyncio
import time

from utils import batch_process_items, log_processing_info
from dotenv import load_dotenv

load_dotenv()


class VectorDBManager:
    """Manage vector database operations for text and image embeddings"""

    def __init__(self):
        self.pc: Optional[Pinecone] = None
        self.text_index = None
        self.image_index = None
        self._initialized = False

        # Configuration
        self.TEXT_INDEX_NAME = "text-index-dev"
        self.IMAGE_INDEX_NAME = "image-index-dev"
        self.TEXT_DIMENSION = 768  # LaBSE dimension
        self.IMAGE_DIMENSION = 768  # CLIP
        self.METRIC = "cosine"
        self.CLOUD = "aws"
        self.REGION = "us-east-1"

        # Batch processing settings
        self.UPSERT_BATCH_SIZE = 100
        self.QUERY_BATCH_SIZE = 1000

    async def initialize(self):
        """Initialize Pinecone connection and indices"""
        if self._initialized:
            return

        try:
            api_key = os.getenv("PINECONE_API_KEY")
            if not api_key:
                raise ValueError("PINECONE_API_KEY environment variable not set")

            print("🗄️ Connecting to Pinecone...")
            self.pc = Pinecone(api_key=api_key)

            # Initialize text index
            await self._initialize_text_index()

            # Initialize image index
            await self._initialize_image_index()

            self._initialized = True
            print("✅ Vector database connection established!")

        except Exception as e:
            print(f"❌ Error initializing vector database: {e}")
            raise e

    async def _initialize_text_index(self):
        """Initialize text embeddings index"""
        try:
            # Check if index exists
            existing_indices = [index.name for index in self.pc.list_indexes()]

            if self.TEXT_INDEX_NAME not in existing_indices:
                print(f"📚 Creating text index: {self.TEXT_INDEX_NAME}")
                self.pc.create_index(
                    name=self.TEXT_INDEX_NAME,
                    dimension=self.TEXT_DIMENSION,
                    metric=self.METRIC,
                    spec=ServerlessSpec(cloud=self.CLOUD, region=self.REGION),
                )

                # Wait for index to be ready
                await self._wait_for_index_ready(self.TEXT_INDEX_NAME)

            self.text_index = self.pc.Index(self.TEXT_INDEX_NAME)
            print(f"✅ Text index ready: {self.TEXT_INDEX_NAME}")

        except Exception as e:
            print(f"❌ Error initializing text index: {e}")
            raise e

    async def _initialize_image_index(self):
        """Initialize image embeddings index"""
        try:
            # Check if index exists
            existing_indices = [index.name for index in self.pc.list_indexes()]

            if self.IMAGE_INDEX_NAME not in existing_indices:
                print(f"🖼️ Creating image index: {self.IMAGE_INDEX_NAME}")
                self.pc.create_index(
                    name=self.IMAGE_INDEX_NAME,
                    dimension=self.IMAGE_DIMENSION,
                    metric=self.METRIC,
                    spec=ServerlessSpec(cloud=self.CLOUD, region=self.REGION),
                )

                # Wait for index to be ready
                await self._wait_for_index_ready(self.IMAGE_INDEX_NAME)

            self.image_index = self.pc.Index(self.IMAGE_INDEX_NAME)
            print(f"✅ Image index ready: {self.IMAGE_INDEX_NAME}")

        except Exception as e:
            print(f"❌ Error initializing image index: {e}")
            raise e

    async def _wait_for_index_ready(self, index_name: str, max_wait: int = 300):
        """Wait for index to be ready"""
        print(f"⏳ Waiting for index {index_name} to be ready...")
        start_time = time.time()

        while time.time() - start_time < max_wait:
            try:
                index_stats = self.pc.describe_index(index_name)
                if index_stats.status.ready:
                    print(f"✅ Index {index_name} is ready!")
                    return
            except Exception as e:
                print(f"⚠️ Error checking index status: {e}")

            await asyncio.sleep(5)

        raise TimeoutError(f"Index {index_name} not ready after {max_wait} seconds")

    def is_connected(self) -> bool:
        """Check if vector database is connected and ready"""
        return (
            self._initialized
            and self.pc is not None
            and self.text_index is not None
            and self.image_index is not None
        )

    async def upsert_text_embedding(
        self, doc_id: str, embedding: np.ndarray, text: str, user_id: str, batch_id: str
    ) -> bool:
        """Upsert single text embedding"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            vector_id = f"text_{doc_id}"
            vector_data = (
                embedding.tolist() if isinstance(embedding, np.ndarray) else embedding
            )

            # Default metadata
            vector_metadata = {
                "type": "text",
                "doc_id": doc_id,
                "timestamp": time.time(),
                "user_id": user_id,  # เพิ่ม user_id ใน metadata
                "batch_id": batch_id,
            }

            # Upsert to Pinecone
            self.text_index.upsert([(vector_id, vector_data, vector_metadata)])

            print(f"📚 Upserted text embedding for document: {doc_id}")
            return True

        except Exception as e:
            print(f"❌ Error upserting text embedding for {doc_id}: {e}")
            return False

    async def upsert_image_embeddings(
        self, doc_id: str, image_items: List[Dict], user_id: str, batch_id: str
    ) -> bool:
        """Upsert multiple image embeddings for a document"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        if not image_items:
            print(f"⚠️ No image embeddings to upsert for document: {doc_id}")
            return True

        try:
            # Prepare batch upsert data
            upsert_data = []

            for i, item in enumerate(image_items):
                vector_id = f"image_{doc_id}_{i}"
                embedding = item["embedding"]
                vector_data = (
                    embedding.tolist()
                    if isinstance(embedding, np.ndarray)
                    else embedding
                )

                # Build metadata
                vector_metadata = {
                    "type": "image",
                    "doc_id": doc_id,
                    "image_index": i,
                    "phash": item.get("phash_hex", ""),
                    "timestamp": time.time(),
                    "user_id": user_id,  # เพิ่ม user_id ใน metadata
                    "batch_id": batch_id,
                }

                upsert_data.append((vector_id, vector_data, vector_metadata))

            # Batch upsert
            for batch in batch_process_items(upsert_data, self.UPSERT_BATCH_SIZE):
                self.image_index.upsert(batch)

            print(
                f"🖼️ Upserted {len(image_items)} image embeddings for document: {doc_id}"
            )
            return True

        except Exception as e:
            print(f"❌ Error upserting image embeddings for {doc_id}: {e}")
            return False

    async def get_all_text_embeddings(self) -> Dict[str, np.ndarray]:
        """Retrieve all text embeddings from the index"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            stats = self.text_index.describe_index_stats()
            total_vectors = stats.total_vector_count

            if total_vectors == 0:
                print("No text embeddings found in index")
                return {}

            # Query all vectors using zero vector
            zero_vector = [0.0] * self.TEXT_DIMENSION
            response = self.text_index.query(
                vector=zero_vector,
                top_k=min(total_vectors, self.QUERY_BATCH_SIZE),
                include_values=True,
                include_metadata=True,
            )

            embeddings = {}
            for match in response.matches:
                embeddings[match.id] = np.array(match.values, dtype=np.float32)

            print(f"Retrieved {len(embeddings)} text embeddings")
            return embeddings

        except Exception as e:
            print(f"Error retrieving text embeddings: {e}")
            return {}

    async def get_all_image_embeddings(
        self,
    ) -> Tuple[Dict[str, np.ndarray], Dict[str, str]]:
        """Retrieve all image embeddings and hashes from the index"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            stats = self.image_index.describe_index_stats()
            total_vectors = stats.total_vector_count

            if total_vectors == 0:
                print("🖼️ No image embeddings found in index")
                return {}, {}

            # Query all vectors using zero vector
            zero_vector = [0.0] * self.IMAGE_DIMENSION
            response = self.image_index.query(
                vector=zero_vector,
                top_k=min(total_vectors, self.QUERY_BATCH_SIZE),
                include_values=True,
                include_metadata=True,
            )

            embeddings = {}
            hashes = {}

            for match in response.matches:
                embeddings[match.id] = np.array(match.values, dtype=np.float32)
                metadata = match.metadata or {}
                hashes[match.id] = metadata.get("phash", "")

            print(f"🖼️ Retrieved {len(embeddings)} image embeddings")
            return embeddings, hashes

        except Exception as e:
            print(f"❌ Error retrieving image embeddings: {e}")
            return {}, {}

    async def retrieve_embeddings_for_batch(
        self, user_id: str, batch_id: str
    ) -> Tuple[Dict, Dict]:

        if not self.is_connected():
            print("❌ Not connected to Pinecone")
            return {}, {}

        try:
            print(f"\n========== RETRIEVING EMBEDDINGS ==========")
            print(f"User ID: {user_id}")
            print(f"Batch ID: {batch_id}")

            # ✅ สร้าง filter หลัก: ต้องมี user_id เสมอ
            pinecone_filter = {"user_id": {"$eq": user_id}}

            # ✅ ถ้าไม่ใช่ ALL ค่อยกรอง batch_id
            if batch_id and batch_id != "ALL":
                pinecone_filter["batch_id"] = {"$eq": batch_id}

            # 1) ดึง Text embeddings
            text_embeddings = {}
            try:
                print("\n Querying text embeddings...")
                text_results = self.text_index.query(
                    vector=[0.0] * self.TEXT_DIMENSION,
                    filter=pinecone_filter,
                    top_k=10000,
                    include_values=True,
                    include_metadata=True,
                )

                print(f"Text query returned {len(text_results.matches)} results")

                for match in text_results.matches:
                    vector_id = match.id
                    text_embeddings[vector_id] = np.array(
                        match.values, dtype=np.float32
                    )

            except Exception as e:
                print(f"🟡 Error querying text embeddings: {e}")
                import traceback

                traceback.print_exc()

            # 2) ดึง Image embeddings
            image_embeddings = {}
            try:
                print("\n🖼️ Querying image embeddings...")
                image_results = self.image_index.query(
                    vector=[0.0] * self.IMAGE_DIMENSION,
                    filter=pinecone_filter,
                    top_k=10000,
                    include_values=True,
                    include_metadata=True,
                )

                print(f"Image query returned {len(image_results.matches)} results")

                for match in image_results.matches:
                    vector_id = match.id
                    image_embeddings[vector_id] = np.array(
                        match.values, dtype=np.float32
                    )

            except Exception as e:
                print(f"⚠️ Error querying image embeddings: {e}")
                import traceback

                traceback.print_exc()

            print(f"\n========== RETRIEVAL COMPLETE ==========")
            print(f"Text embeddings: {len(text_embeddings)}")
            print(f"Image embeddings: {len(image_embeddings)}")

            return text_embeddings, image_embeddings

        except Exception as e:
            print(f"❌ Error retrieving embeddings for batch {batch_id}: {e}")
            import traceback

            traceback.print_exc()
            return {}, {}

    async def delete_document_embeddings(self, doc_id: str) -> bool:
        """Delete all embeddings for a specific document"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            # Delete text embedding
            text_id = f"text_{doc_id}"
            try:
                self.text_index.delete(ids=[text_id])
                print(f"🗑️ Deleted text embedding for document: {doc_id}")
            except Exception as e:
                print(f"⚠️ Warning: Could not delete text embedding for {doc_id}: {e}")

            # Delete image embeddings
            # First, find all image embeddings for this document
            try:
                stats = self.image_index.describe_index_stats()
                if stats.total_vector_count > 0:
                    zero_vector = [0.0] * self.IMAGE_DIMENSION
                    response = self.image_index.query(
                        vector=zero_vector,
                        top_k=stats.total_vector_count,
                        include_metadata=True,
                    )

                    # Find matching document IDs
                    image_ids_to_delete = []
                    for match in response.matches:
                        metadata = match.metadata or {}
                        if metadata.get("doc_id") == doc_id:
                            image_ids_to_delete.append(match.id)

                    # Delete image embeddings
                    if image_ids_to_delete:
                        for batch in batch_process_items(
                            image_ids_to_delete, self.UPSERT_BATCH_SIZE
                        ):
                            self.image_index.delete(ids=batch)
                        print(
                            f"🗑️ Deleted {len(image_ids_to_delete)} image embeddings for document: {doc_id}"
                        )

            except Exception as e:
                print(f"⚠️ Warning: Could not delete image embeddings for {doc_id}: {e}")

            return True

        except Exception as e:
            print(f"❌ Error deleting embeddings for {doc_id}: {e}")
            return False

    async def delete_document_embeddings_for_user(
        self,
        doc_id: str,
        user_id: str,
        batch_id: Optional[str] = None,
    ) -> None:
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        # 0) ลบ text ด้วย ID ตายตัวก่อน (ชัวร์สุด)
        try:
            self.text_index.delete(ids=[f"text_{doc_id}"])
        except Exception as e:
            print(f"⚠️ Text ID delete failed for {doc_id}: {e}")

        # 1) filter หลัก (ลบเผื่อเคสที่ id ไม่ตาม pattern หรือมีหลายอัน)
        f = {"doc_id": {"$eq": doc_id}, "user_id": {"$eq": user_id}}
        if batch_id:
            f["batch_id"] = {"$eq": batch_id}

        # 2) ลบ text ซ้ำด้วย filter
        try:
            self.text_index.delete(filter=f)
        except Exception as e:
            print(f"⚠️ Text filter delete failed for {doc_id}: {e}")

        # 3) ลบ image ด้วย filter
        try:
            self.image_index.delete(filter=f)
        except Exception as e:
            print(f"⚠️ Image filter delete failed for {doc_id}: {e}")

    async def delete_document_embeddings_by_ids(
        self,
        doc_id: str,
        image_count: int,
        user_id: str,
        batch_id: Optional[str] = None,
    ) -> None:
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        # text by id
        try:
            self.text_index.delete(ids=[f"text_{doc_id}"])
        except Exception as e:
            print(f"⚠️ Text ID delete failed for {doc_id}: {e}")

        # images by ids
        if image_count and image_count > 0:
            ids = [f"image_{doc_id}_{i}" for i in range(image_count)]
            for batch in batch_process_items(ids, self.UPSERT_BATCH_SIZE):
                try:
                    self.image_index.delete(ids=batch)
                except Exception as e:
                    print(f"⚠️ Image ID delete failed for batch: {e}")

        # ✅ fallback ลบซ้ำด้วย filter กันหลงเหลือ
        f = {"doc_id": {"$eq": doc_id}, "user_id": {"$eq": user_id}}
        if batch_id:
            f["batch_id"] = {"$eq": batch_id}
        try:
            self.image_index.delete(filter=f)
            self.text_index.delete(filter=f)
        except Exception as e:
            print(f"⚠️ Fallback filter delete failed for {doc_id}: {e}")

    async def clear_all_indices(self) -> bool:
        """Clear all embeddings from both indices"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            print("🗑️ Clearing all embeddings...")

            # Clear text index
            try:
                self.text_index.delete(delete_all=True)
                print("🗑️ Cleared text index")
            except Exception as e:
                print(f"⚠️ Warning: Could not clear text index: {e}")

            # Clear image index
            try:
                self.image_index.delete(delete_all=True)
                print("🗑️ Cleared image index")
            except Exception as e:
                print(f"⚠️ Warning: Could not clear image index: {e}")

            print("✅ All indices cleared successfully")
            return True

        except Exception as e:
            print(f"❌ Error clearing indices: {e}")
            return False

    async def get_text_index_stats(self) -> Dict[str, Any]:
        """Get text index statistics"""
        if not self.is_connected():
            return {"error": "Not connected"}

        try:
            stats = self.text_index.describe_index_stats()
            return {
                "total_vector_count": stats.total_vector_count,
                "dimension": stats.dimension,
                "index_fullness": stats.index_fullness,
                "namespaces": dict(stats.namespaces) if stats.namespaces else {},
            }
        except Exception as e:
            return {"error": str(e)}

    async def get_image_index_stats(self) -> Dict[str, Any]:
        """Get image index statistics"""
        if not self.is_connected():
            return {"error": "Not connected"}

        try:
            stats = self.image_index.describe_index_stats()
            return {
                "total_vector_count": stats.total_vector_count,
                "dimension": stats.dimension,
                "index_fullness": stats.index_fullness,
                "namespaces": dict(stats.namespaces) if stats.namespaces else {},
            }
        except Exception as e:
            return {"error": str(e)}

    async def search_similar_texts(
        self, query_embedding: np.ndarray, top_k: int = 10, threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """Search for similar text embeddings"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            query_vector = (
                query_embedding.tolist()
                if isinstance(query_embedding, np.ndarray)
                else query_embedding
            )

            response = self.text_index.query(
                vector=query_vector,
                top_k=top_k,
                include_values=False,
                include_metadata=True,
            )

            results = []
            for match in response.matches:
                if match.score >= threshold:
                    results.append(
                        {
                            "id": match.id,
                            "score": match.score,
                            "metadata": match.metadata,
                        }
                    )

            return results

        except Exception as e:
            print(f"❌ Error searching similar texts: {e}")
            return []

    async def search_similar_images(
        self, query_embedding: np.ndarray, top_k: int = 10, threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """Search for similar image embeddings"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            query_vector = (
                query_embedding.tolist()
                if isinstance(query_embedding, np.ndarray)
                else query_embedding
            )

            response = self.image_index.query(
                vector=query_vector,
                top_k=top_k,
                include_values=False,
                include_metadata=True,
            )

            results = []
            for match in response.matches:
                if match.score >= threshold:
                    results.append(
                        {
                            "id": match.id,
                            "score": match.score,
                            "metadata": match.metadata,
                        }
                    )

            return results

        except Exception as e:
            print(f"❌ Error searching similar images: {e}")
            return []

    async def get_document_embeddings(
        self, doc_id: str
    ) -> Tuple[Optional[np.ndarray], List[Dict[str, Any]]]:
        """Get all embeddings for a specific document"""
        if not self.is_connected():
            raise RuntimeError("Vector database not initialized")

        try:
            text_embedding = None
            image_embeddings = []

            # Get text embedding
            text_id = f"text_{doc_id}"
            try:
                # Use a dummy query to find the specific vector
                zero_vector = [0.0] * self.TEXT_DIMENSION
                response = self.text_index.query(
                    vector=zero_vector,
                    filter={"doc_id": doc_id},
                    top_k=1,
                    include_values=True,
                )

                if response.matches:
                    text_embedding = np.array(
                        response.matches[0].values, dtype=np.float32
                    )

            except Exception as e:
                print(f"⚠️ Warning: Could not retrieve text embedding for {doc_id}: {e}")

            # Get image embeddings
            try:
                zero_vector = [0.0] * self.IMAGE_DIMENSION
                response = self.image_index.query(
                    vector=zero_vector,
                    filter={"doc_id": doc_id},
                    top_k=1000,  # Assume max 1000 images per document
                    include_values=True,
                    include_metadata=True,
                )

                for match in response.matches:
                    image_embeddings.append(
                        {
                            "id": match.id,
                            "embedding": np.array(match.values, dtype=np.float32),
                            "metadata": match.metadata,
                        }
                    )

            except Exception as e:
                print(
                    f"⚠️ Warning: Could not retrieve image embeddings for {doc_id}: {e}"
                )

            return text_embedding, image_embeddings

        except Exception as e:
            print(f"❌ Error retrieving document embeddings for {doc_id}: {e}")
            return None, []

    def cleanup(self):
        """Clean up vector database connections"""
        try:
            self.text_index = None
            self.image_index = None
            self.pc = None
            self._initialized = False
            print("🧹 Vector database connections cleaned up")
        except Exception as e:
            print(f"⚠️ Warning: Error during vector database cleanup: {e}")

    def get_connection_info(self) -> Dict[str, Any]:
        """Get vector database connection information"""
        return {
            "initialized": self._initialized,
            "connected": self.is_connected(),
            "text_index_name": self.TEXT_INDEX_NAME,
            "image_index_name": self.IMAGE_INDEX_NAME,
            "text_dimension": self.TEXT_DIMENSION,
            "image_dimension": self.IMAGE_DIMENSION,
            "metric": self.METRIC,
            "cloud": self.CLOUD,
            "region": self.REGION,
        }
