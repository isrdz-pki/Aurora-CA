import os
import time
import uuid
import subprocess
import tempfile
import threading
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr

app = FastAPI(title="Aurora CA API - DEBUG", version="999")

# CORS para seu GitHub Pages
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://israelzinho.github.io",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

class CertRequest(BaseModel):
    nome: str
    email: EmailStr
    telefone: str
    cpf: str
    endereco: str


# --- Config ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CA_DIR = os.path.join(BASE_DIR, "CA")
OPENSSL_CNF = os.path.join(CA_DIR, "openssl_api.cnf")

def pick_existing_file(*candidates: str):
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None

# chain: primeiro tenta chain.crt (se existir), senão usa o intermediário
CHAIN_FILE = pick_existing_file(
    os.path.join(CA_DIR, "chain.crt"),
    os.path.join(CA_DIR, "intermediate", "certs", "aurora-int.crt"),
    os.path.join(CA_DIR, "intermediate", "certs", "Aurora-INT.crt"),
)

PFX_STORE_DIR = "/tmp/pfx_store"
os.makedirs(PFX_STORE_DIR, exist_ok=True)

STORE: dict[str, dict] = {}
TTL_SECONDS = 10 * 60
CA_LOCK = threading.Lock()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "time": datetime.utcnow().isoformat(),
        "BASE_DIR": BASE_DIR,
        "BASE_DIR_files": sorted(os.listdir(BASE_DIR)) if os.path.exists(BASE_DIR) else None,
        "CA_DIR": CA_DIR,
        "CA_DIR_exists": os.path.exists(CA_DIR),
        "CA_DIR_files": sorted(os.listdir(CA_DIR)) if os.path.exists(CA_DIR) else None,
        "OPENSSL_CNF": OPENSSL_CNF,
        "OPENSSL_CNF_exists": os.path.exists(OPENSSL_CNF),
        "CHAIN_FILE": CHAIN_FILE,
        "CHAIN_FILE_exists": os.path.exists(CHAIN_FILE or ""),
    }

def _cleanup_expired():
    now = time.time()
    expired = [k for k, v in STORE.items() if v["expires_at"] <= now]
    for k in expired:
        path = STORE[k]["path"]
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        STORE.pop(k, None)

def _generate_pfx(payload: CertRequest) -> str:
    print("BASE_DIR:", BASE_DIR, flush=True)
    print("CWD:", os.getcwd(), flush=True)
    print("OPENSSL_CNF:", OPENSSL_CNF, "exists?", os.path.exists(OPENSSL_CNF), flush=True)
    print("CA_DIR:", CA_DIR, "exists?", os.path.exists(CA_DIR), flush=True)
    print("CHAIN_FILE:", CHAIN_FILE, "exists?", os.path.exists(CHAIN_FILE or ""), flush=True)
    print("BASE_DIR files:", os.listdir(BASE_DIR), flush=True)

    if not OPENSSL_CNF or not os.path.exists(OPENSSL_CNF):
        raise HTTPException(500, f"openssl_api.cnf não encontrado em {OPENSSL_CNF}")

    if not CHAIN_FILE or not os.path.exists(CHAIN_FILE):
        raise HTTPException(500, "CHAIN_FILE não encontrado (chain.crt / aurora-int.crt).")

    # ✅ checa a chave privada da intermediária no path esperado
    INT_KEY = os.path.join(BASE_DIR, "CA", "intermediate", "private", "aurora-int.key")
    print("INT_KEY:", INT_KEY, "exists?", os.path.exists(INT_KEY), flush=True)
    if not os.path.exists(INT_KEY):
        raise HTTPException(500, f"Chave da intermediária não encontrada: {INT_KEY}")

    safe_nome = payload.nome.replace("/", "-").replace("\\", "-").strip()
    subj = f"/C=BR/O=Aurora/OU=Cliente/CN={safe_nome}/emailAddress={payload.email}"

    # senha do pfx (teste)
    pfx_pass = "1234"

    with tempfile.TemporaryDirectory() as tmp:
        key_path = os.path.join(tmp, "client.key")
        csr_path = os.path.join(tmp, "client.csr")
        crt_path = os.path.join(tmp, "client.crt")

        # 1) chave
        try:
            subprocess.run(
                ["openssl", "genrsa", "-out", key_path, "2048"],
                check=True, capture_output=True, text=True
            )
        except subprocess.CalledProcessError as e:
            raise HTTPException(500, f"Erro no OpenSSL (genrsa): {e.stderr or e.stdout or str(e)}")

        # 2) csr
        try:
            subprocess.run(
                ["openssl", "req", "-new", "-key", key_path, "-out", csr_path, "-subj", subj],
                check=True, capture_output=True, text=True
            )
        except subprocess.CalledProcessError as e:
            raise HTTPException(500, f"Erro no OpenSSL (req): {e.stderr or e.stdout or str(e)}")

              # 3) assina com CA intermediária — PROTEGER COM LOCK
        ca_pass = os.getenv("AURORA_INT_KEY_PASS", "")
        if not ca_pass:
            raise HTTPException(500, "AURORA_INT_KEY_PASS não configurada no Railway.")
        
        with CA_LOCK:
            try:
                subprocess.run(
                    [
                        "openssl", "ca",
                        "-config", OPENSSL_CNF,
                        "-in", csr_path,
                        "-out", crt_path,
                        "-batch",
                        "-passin", f"pass:{ca_pass}"
                    ],
                    check=True, capture_output=True, text=True,
                    cwd=BASE_DIR
                )
            except subprocess.CalledProcessError as e:
                raise HTTPException(500, f"Erro no OpenSSL (ca): {e.stderr or e.stdout or str(e)}")


        # 4) exporta pfx (fora do tmp, pra persistir)
        os.makedirs(PFX_STORE_DIR, exist_ok=True)
        download_id = uuid.uuid4().hex
        pfx_path = os.path.join(PFX_STORE_DIR, f"{download_id}.pfx")

        try:
            subprocess.run(
                [
                    "openssl", "pkcs12", "-export",
                    "-out", pfx_path,
                    "-inkey", key_path,
                    "-in", crt_path,
                    "-certfile", CHAIN_FILE,
                    "-passout", f"pass:{pfx_pass}"
                ],
                check=True, capture_output=True, text=True
            )
        except subprocess.CalledProcessError as e:
            raise HTTPException(500, f"Erro no OpenSSL (pkcs12): {e.stderr or e.stdout or str(e)}")

        return pfx_path




    return pfx_path
@app.post("/validate")
def validate_and_store(payload: CertRequest):
    # limpa expirados a cada chamada (simples)
    _cleanup_expired()

    try:
        pfx_path = _generate_pfx(payload)
    except subprocess.CalledProcessError as e:
        msg = (e.stderr or e.stdout or "Erro OpenSSL").strip()
        raise HTTPException(500, f"Erro no OpenSSL: {msg[:500]}")

    download_id = os.path.splitext(os.path.basename(pfx_path))[0]
    STORE[download_id] = {"path": pfx_path, "expires_at": time.time() + TTL_SECONDS}

    return {
        "download_id": download_id,
        "expires_in_seconds": TTL_SECONDS
    }

@app.get("/download/{download_id}")
def download(download_id: str, background_tasks: BackgroundTasks):
    _cleanup_expired()

    item = STORE.get(download_id)
    if not item:
        raise HTTPException(404, "Certificado expirou ou não existe mais")

    path = item["path"]
    if not os.path.exists(path):
        STORE.pop(download_id, None)
        raise HTTPException(404, "Arquivo não encontrado (serviço reiniciou?)")

    # Apaga após baixar (bom pra não acumular)
    def _delete_after():
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        STORE.pop(download_id, None)

    background_tasks.add_task(_delete_after)

    return FileResponse(
        path=path,
        media_type="application/x-pkcs12",
        filename="certificado.pfx"
    )
















