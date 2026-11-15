#!/usr/bin/env python3
"""Drive the running VM through its QEMU monitor (run from the repo root).

  ctl.py shot out.png        screenshot (PNG)
  ctl.py type "ls -la"       type text, then Enter (works once a terminal window has focus)
  ctl.py key tab tab ret     send raw QEMU key names

The pointer is not reachable this way; use Tab/Enter to navigate the shell.
"""
import os, socket, struct, sys, time, zlib

SOCK = os.path.join(os.environ.get("BRASOS_VM_DIR", ".vm"), "mon.sock")
PLAIN = {" ": "spc", "-": "minus", ".": "dot", "/": "slash", ";": "semicolon", "'": "apostrophe", "=": "equal",
         ",": "comma", "\\": "backslash", "\n": "ret"}
SHIFT = {">": "dot", "(": "9", ")": "0", "_": "minus", "&": "7", "|": "backslash", "$": "4", ":": "semicolon",
         '"': "apostrophe", "*": "8", "<": "comma", "{": "bracket_left", "}": "bracket_right", "!": "1",
         "~": "grave_accent", "+": "equal", "#": "3", "%": "5"}


def monitor():
    s = socket.socket(socket.AF_UNIX)
    s.connect(SOCK)
    time.sleep(0.3)
    s.recv(4096)
    return s


def cmd(s, line, wait=0.06):
    s.send(f"{line}\n".encode())
    time.sleep(wait)
    s.recv(4096)


def key_for(ch):
    if ch in PLAIN:
        return PLAIN[ch]
    if ch in SHIFT:
        return "shift-" + SHIFT[ch]
    return "shift-" + ch.lower() if ch.isupper() else ch


def shot(path):
    s = monitor()
    cmd(s, "screendump /tmp/brasos-shot.ppm", 1.5)
    head, size, _, px = open("/tmp/brasos-shot.ppm", "rb").read().split(b"\n", 3)
    w, h = map(int, size.split())
    raw = b"".join(b"\0" + px[y * w * 3:(y + 1) * w * 3] for y in range(h))
    chunk = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    op, args = sys.argv[1], sys.argv[2:]
    if op == "shot":
        shot(args[0])
    elif op == "type":
        s = monitor()
        for ch in args[0] + "\n":
            cmd(s, f"sendkey {key_for(ch)}")
    elif op == "key":
        s = monitor()
        for k in args:
            cmd(s, f"sendkey {k}", 0.2)
    else:
        sys.exit(__doc__)
