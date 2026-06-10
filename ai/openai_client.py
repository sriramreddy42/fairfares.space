import os
from openai import OpenAI


def get_api_key():
    return os.getenv("OPENAI_API_KEY")


def get_client():
    key = get_api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY environment variable is not set")
    return OpenAI(api_key=key)


def chat_completion(messages, model="gpt-3.5-turbo", temperature=0.2):
    """Send a ChatCompletion request. `messages` should be a list of dicts per OpenAI API."""
    client = get_client()
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    return resp.choices[0].message.content


def code_completion(prompt, model="gpt-3.5-turbo", temperature=0.0):
    """Ask the model to generate code; uses chat endpoint with a coding system role."""
    client = get_client()
    messages = [
        {"role": "system", "content": "You are a helpful coding assistant. Respond with code when appropriate."},
        {"role": "user", "content": prompt},
    ]
    resp = client.chat.completions.create(model=model, messages=messages, temperature=temperature)
    return resp.choices[0].message.content
