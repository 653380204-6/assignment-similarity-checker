# from supabase import create_client, Client

# import os
# from dotenv import load_dotenv

# load_dotenv()

# SUPABASE_URL: str = os.environ.get("SUPABASE_URL")
# SUPABASE_SERVICE_ROLE_KEY: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
# sb_anon_key: str = os.environ.get("SUPABASE_ANON_KEY")

# supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# from supabase import create_client, Client
# import os
# from dotenv import load_dotenv

# load_dotenv()

# # << ใส่บล็อกตรวจว่ากำลังใช้คีย์ไหนอยู่ตรงนี้ >>
# key_source = (
#     "SERVICE" if os.environ.get("SUPABASE_SERVICE_ROLE_KEY") else
#     "KEY"     if os.environ.get("SUPABASE_KEY") else
#     "ANON"
# )
# print(f"[Supabase] key source: {key_source}")

# sb_url: str = os.environ.get("SUPABASE_URL")
# sb_key: str = (
#     os.environ.get("SUPABASE_SERVICE_ROLE_KEY")  # ใช้ service role ถ้ามี
#     or os.environ.get("SUPABASE_KEY")
#     or os.environ.get("SUPABASE_ANON_KEY")
# )

# if not sb_url or not sb_key:
#     raise RuntimeError("Missing SUPABASE_URL or Supabase key in environment")

# supabase: Client = create_client(sb_url, sb_key)

from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

sb_url: str = os.environ.get("SUPABASE_URL")
sb_key: str = os.environ.get("SUPABASE_KEY")
sb_anon_key: str = os.environ.get("SUPABASE_ANON_KEY")

supabase: Client = create_client(sb_url, sb_key)
sb_service_role: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase_admin: Client | None = (
    create_client(sb_url, sb_service_role) if sb_service_role else None
)
