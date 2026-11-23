from __future__ import annotations

import math
import re
from collections import Counter


def terms(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9_]+", text.lower())
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        words.extend(run[i:i+2] for i in range(len(run)-1))
        if len(run) == 1:
            words.append(run)
    return words


def retrieve(query: str, documents: list[dict], budget: int = 8000) -> dict:
    query_terms = set(terms(query)[:128])
    chunks = []
    for document in documents:
        text = document["content"]
        for start in range(0, len(text), 1000):
            content = text[start:start+1200]
            words = terms(content)
            if not words:
                continue
            chunks.append({"document_id": document["id"], "title": document["title"], "source_uri": document["source_uri"],
                           "source_sha256": document["sha256"], "locator": {"offset": start, "length": len(content), "encoding": "unicode-codepoints"},
                           "content": content, "counts": Counter(words), "length": len(words)})
    n = len(chunks)
    if not n or not query_terms:
        return {"status": "insufficient", "method": "bm25-text-v1", "citations": []}
    frequencies = {word: sum(word in c["counts"] for c in chunks) for word in query_terms}
    mean_length = sum(c["length"] for c in chunks) / n
    for chunk in chunks:
        score = 0.0
        for word in query_terms:
            tf = chunk["counts"].get(word, 0)
            idf = math.log(1 + (n - frequencies[word] + 0.5) / (frequencies[word] + 0.5))
            score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * chunk["length"] / mean_length))
        chunk["score"] = score
    selected = []
    used = 0
    for chunk in sorted(chunks, key=lambda c: (-c["score"], c["document_id"], c["locator"]["offset"])):
        if chunk["score"] <= 0 or len(selected) >= 6:
            break
        size = len(chunk["content"].encode())
        if used + size > budget:
            continue
        used += size
        selected.append({k: v for k, v in chunk.items() if k not in {"counts", "length"}})
    return {"status": "retrieved" if selected else "insufficient", "method": "bm25-text-v1", "citations": selected}
