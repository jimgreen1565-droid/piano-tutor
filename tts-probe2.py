# -*- coding: utf-8 -*-
"""探测 breeze-server 的 HTTP 接口 + 试合成一句，确认音色 id 可用。"""
import json
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8080"


def get(path, timeout=25):
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            body = r.read()
            return r.status, body[:1200]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]
    except Exception as e:
        return None, str(e).encode("utf-8", "replace")


print("--- health ---")
for _ in range(10):
    st, body = get("/health", 5)
    if st == 200:
        print("health:", st, body.decode("utf-8", "replace"))
        break
    time.sleep(3)
else:
    print("health never ok, last:", st, body)

print("--- endpoints ---")
for p in ["/v1/voices", "/voices", "/api/voices", "/v1/models", "/v1/audio/voices"]:
    st, body = get(p, 20)
    print(f"{p:22} -> {st} {body[:300].decode('utf-8','replace')}")

print("--- test synthesis (voice=female_anchor) ---")
payload = {
    "input": "第 5 小节最明显，另外 6 小节也有。",
    "response_format": "mp3",
    "seed": 7,
    "voice": {"id": "female_anchor"},
}
try:
    req = urllib.request.Request(
        BASE + "/v1/audio/speech",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        data = r.read()
    open("tts-test-female.mp3", "wb").write(data)
    print(f"ok {len(data)} bytes in {time.time()-t0:.1f}s, head={data[:4]}")
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode("utf-8", "replace")[:400])
except Exception as e:
    print("failed:", e)
