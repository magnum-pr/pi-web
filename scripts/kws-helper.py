#!/usr/bin/env python3
"""PocketSphinx keyword-spotting helper for pi-web's voice wake word.

Reads JSON lines on stdin:
    {"id": "<request-id>", "audio": "<base64 16 kHz int16 mono PCM>"}

Writes JSON lines on stdout:
    {"id": "<request-id>", "detected": "<wake|stop>" | null}

The wake and stop phrases are passed as argv (so they're configurable), e.g.:
    kws-helper.py --wake oracle --stop "send it"
Two PocketSphinx decoders run in parallel (one per phrase). Offline, no keys.
Each phrase is detected under a stable label: the wake decoder reports
"wake", the stop decoder reports "stop" (so renaming the phrase doesn't
break the client logic).
"""

import argparse
import base64
import json
import sys
from typing import Optional

from pocketsphinx import Config, Decoder


def make_decoders(wake: str, stop: str, threshold: Optional[float] = None) -> dict:
    """Build one PocketSphinx decoder per phrase."""
    thr = threshold if threshold is not None else 1e-20
    return {
        "wake": Decoder(Config(keyphrase=wake, kws_threshold=thr)),
        "stop": Decoder(Config(keyphrase=stop, kws_threshold=thr)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wake", default="oracle")
    parser.add_argument("--stop", default="send it")
    args = parser.parse_args()

    decoders = make_decoders(args.wake, args.stop)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue

        # Optional per-request threshold override (hot-reloaded config).
        threshold = req.get("threshold")
        if isinstance(threshold, (int, float)):
            decoders = make_decoders(args.wake, args.stop, float(threshold))

        pcm = base64.b64decode(req.get("audio", "") or "")
        detected = None
        for label, decoder in decoders.items():
            decoder.start_utt()
            decoder.process_raw(pcm, False, False)
            decoder.end_utt()
            if decoder.hyp() is not None:
                detected = label
                break

        sys.stdout.write(json.dumps({"id": req.get("id"), "detected": detected}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
