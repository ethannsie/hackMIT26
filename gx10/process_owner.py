#!/usr/bin/env python3
"""Record Linux process identity; never stop a process based on a reused PID."""
import json
import os
from pathlib import Path
import signal
import sys
import time


def identity(pid):
    stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return {"pid": pid, "start": stat[19], "group": int(stat[2]),
            "boot": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}


def record(path, pid):
    owner = identity(pid)
    if owner["group"] != pid:
        raise RuntimeError("service has no private process group")
    path.write_text(json.dumps(owner))


def stop(path):
    try:
        owner = json.loads(path.read_text())
        pid = owner["pid"]
        if not isinstance(pid, int) or pid <= 1 or owner != identity(pid) or owner["group"] != pid:
            raise ValueError("identity no longer matches")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Skipped {path.name}: unverified or expired process record ({exc})")
        return False
    os.killpg(pid, signal.SIGTERM)
    # Give camera/light cleanup time to finish. Only escalate if the same leader lives.
    for _ in range(100):
        time.sleep(0.1)
        try:
            if identity(pid) != owner: break
        except OSError:
            break
    else:
        os.killpg(pid, signal.SIGKILL)
    path.unlink(missing_ok=True)
    print(f"Stopped {path.stem} ({pid})")
    return True


if __name__ == "__main__":
    action, filename, *args = sys.argv[1:]
    if action == "record": record(Path(filename), int(args[0]))
    elif action == "stop": stop(Path(filename))
    else: raise SystemExit("expected record or stop")
