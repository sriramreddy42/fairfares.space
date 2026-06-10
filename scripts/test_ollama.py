import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ai.ollama_client import text_completion, chat_completion


def run_text_test():
    prompt = "Write a short greeting from Deepseek in one sentence."
    out = text_completion(prompt)
    print("Text completion output:\n", out)


def run_chat_test():
    messages = [
        {"role": "system", "content": "You are Deepseek, a helpful assistant."},
        {"role": "user", "content": "Introduce yourself in one sentence."},
    ]
    out = chat_completion(messages)
    print("Chat completion output:\n", out)


if __name__ == '__main__':
    print("Running Ollama text test...")
    try:
        run_text_test()
    except Exception as e:
        print("Text test failed:", e)

    print('\nRunning Ollama chat test...')
    try:
        run_chat_test()
    except Exception as e:
        print("Chat test failed:", e)
