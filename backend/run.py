import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_includes=[
            "main.py",
            "auth.py",
            "schemas.py",
            "supabase_client.py",
            "utils.py",
            "pdf_processing.py",
            "embedding.py",
            "vector_db.py",
            # ไม่ใส่ embedding.py และ vector_db.py
        ],
        log_level="info",
    )
