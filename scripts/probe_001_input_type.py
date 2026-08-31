#!/usr/bin/env python3
"""Independent check: is input_type on gemini-embedding-001 deterministic?

WHY THIS EXISTS SEPARATELY. The same finding came out of a Node script in this
repo, and "the script is wrong" is a live possibility that cannot be ruled out
from inside that script. This shares no code with it: plain requests, plain
numpy, one file. If it disagrees, believe this one and the Node result is a bug.

WHAT IT MEASURES. It sends the SAME request N times and hashes each returned
vector. A deterministic endpoint returns byte-identical float32 every time.
More than one distinct hash means the same request is being answered two
different ways -- and if one of those hashes matches the no-input_type
baseline, the parameter is being dropped on some calls rather than perturbed.

The float32 rounding is deliberate and matches the Node script: the API returns
float64-precision JSON, so rounding to float32 before hashing HIDES sub-float32
differences. It cannot manufacture a difference, only conceal one. A hash split
here is therefore real.

Set OPENROUTER_API_KEY below, then:

  pip install requests numpy
  python probe_001_input_type.py
  python probe_001_input_type.py --require-parameters   # the possible fix
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import Counter

import numpy as np
import requests

OPENROUTER_API_KEY = ""  # paste sk-or-v1-... here
URL = "https://openrouter.ai/api/v1/embeddings"
MODEL = "google/gemini-embedding-001"

# Short on purpose: the Node run saw the split on a 356-character document.
TEXT = (
    "Chime. Genres: Horror, Thriller. Directed by Kiyoshi Kurosawa. "
    "Studio: Roadstead, Sunborn. A part-time cooking instructor notices "
    "something is wrong with one of his students."
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--repeat", type=int, default=6)
    p.add_argument("--require-parameters", action="store_true")
    # Region-scoped tags from GET /api/v1/models/<id>/endpoints, verified
    # 2026-08-31: google-vertex/us-central1, google-ai-studio. A bare
    # "google-vertex" is not a tag.
    p.add_argument("--pin", default=None, help="google-vertex/us-central1 | google-ai-studio")
    p.add_argument("--timeout", type=float, default=90)
    return p.parse_args()


def embed(key: str, text: str, input_type: str | None, args: argparse.Namespace) -> np.ndarray:
    body: dict = {"model": MODEL, "input": text, "encoding_format": "float"}
    if input_type:
        body["input_type"] = input_type

    provider: dict = {}
    if args.pin:
        provider["only"] = [args.pin]
        provider["allow_fallbacks"] = False
    if args.require_parameters:
        provider["require_parameters"] = True
    if provider:
        body["provider"] = provider

    r = requests.post(
        URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=args.timeout,
    )
    r.raise_for_status()
    return np.asarray(r.json()["data"][0]["embedding"], dtype=np.float32)


def sha(v: np.ndarray) -> str:
    return hashlib.sha256(v.tobytes()).hexdigest()


def main() -> int:
    key = OPENROUTER_API_KEY.strip()
    if not key:
        print("Set OPENROUTER_API_KEY near the top of this script.", file=sys.stderr)
        return 2

    args = parse_args()
    print(f"model   : {MODEL}")
    print(f"repeat  : {args.repeat}")
    print(f"pin     : {args.pin or '(none)'}")
    print(f"require_parameters: {args.require_parameters}")
    print(f"document: {len(TEXT)} chars\n")

    results: dict[str, list[str]] = {}
    for label, input_type in (("no input_type", None), ("semantic_similarity", "semantic_similarity")):
        hashes = []
        for _ in range(args.repeat):
            hashes.append(sha(embed(key, TEXT, input_type, args)))
        results[label] = hashes

        counts = Counter(hashes)
        verdict = "STABLE" if len(counts) == 1 else f"UNSTABLE ({len(counts)} distinct)"
        print(f"{label:<22} {verdict}")
        for h, n in counts.most_common():
            print(f"    {n}/{args.repeat}  {h[:48]}…")
        print()

    baseline = set(results["no input_type"])
    semantic = set(results["semantic_similarity"])
    overlap = baseline & semantic

    print("verdict:")
    if len(semantic) > 1 and overlap:
        print("  input_type is DROPPED on some calls -- one of its vectors is")
        print("  byte-identical to the no-input_type baseline. Not usable as-is.")
    elif len(semantic) > 1:
        print("  input_type is honoured but the endpoint is nondeterministic.")
    elif overlap:
        print("  input_type is ignored entirely: same vector as sending nothing.")
    else:
        print("  input_type is honoured and stable. Usable.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
