# -*- coding: utf-8 -*-
"""启动本机 breeze-server 并列出可用音色。"""
import json
import sys
import urllib.request

sys.path.insert(0, r"D:\ZW\Documents\deepseek-harness\default-workspace")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import breeze_local as B  # noqa: E402

ok = B.ensure_server(wait=240)
print("server health:", ok)

with urllib.request.urlopen(B.BASE + "/v1/voices", timeout=30) as r:
    data = json.loads(r.read().decode("utf-8"))

voices = data.get("voices") if isinstance(data, dict) else data
print("voices:", json.dumps(voices, ensure_ascii=False)[:2000])
