from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import re
import requests

app = FastAPI(title="Consulta CEP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def normalize_cep(value: str) -> str:
    return re.sub(r"\D", "", value or "")


@app.get("/cep/{cep}")
def consulta_cep(cep: str):
    normalized = normalize_cep(cep)
    if len(normalized) != 8:
        raise HTTPException(status_code=400, detail="CEP invalido")

    response = requests.get(f"https://viacep.com.br/ws/{normalized}/json/", timeout=10)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Falha ao consultar CEP")

    data = response.json()
    if data.get("erro"):
        raise HTTPException(status_code=404, detail="CEP nao encontrado")

    return {
        "cep": data.get("cep"),
        "logradouro": data.get("logradouro"),
        "bairro": data.get("bairro"),
        "cidade": data.get("localidade"),
        "uf": data.get("uf"),
        "complemento": data.get("complemento"),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("consulta_cep:app", host="0.0.0.0", port=8000, reload=True)
