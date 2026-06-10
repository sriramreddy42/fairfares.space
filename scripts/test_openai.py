import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ai.openai_client import chat_completion, code_completion


def run_chat_test():
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Say hello briefly and identify yourself."},
    ]
    out = chat_completion(messages)
    print("Chat test output:\n", out)


def run_code_test():
    prompt = "Write a Python function that returns the square of a number. Include a short docstring."
    out = code_completion(prompt)
    print("Code test output:\n", out)


if __name__ == '__main__':
    print("Running OpenAI chat test...")
    try:
        run_chat_test()
    except Exception as e:
        print("Chat test failed:", e)

    print('\nRunning OpenAI code test...')
    try:
        run_code_test()
    except Exception as e:
        print("Code test failed:", e)
