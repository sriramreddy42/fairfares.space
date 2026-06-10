import os
import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/v1")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "deepseek-r1:1.5b")


def _endpoint(path: str) -> str:
    return OLLAMA_URL.rstrip("/") + path


def text_completion(prompt: str, model: str = DEFAULT_MODEL, max_tokens: int = 256, temperature: float = 0.2):
    """Call a local Ollama text-completion model."""
    url = _endpoint("/completions")
    payload = {
        "model": model,
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    resp = requests.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if "text" in data:
        return data["text"]
    if "choices" in data and data["choices"]:
        return data["choices"][0].get("text", "")
    raise RuntimeError(f"Unexpected Ollama response: {data}")


def chat_completion(messages, model: str = DEFAULT_MODEL, temperature: float = 0.2):
    """Call Ollama's chat endpoint using a list of messages."""
    url = _endpoint("/chat/completions")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    resp = requests.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if "choices" in data and data["choices"]:
        return data["choices"][0]["message"]["content"]
    raise RuntimeError(f"Unexpected Ollama response: {data}")
