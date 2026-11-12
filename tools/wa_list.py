"""List the top-level auras in a WeakAuras.lua or ForeverAuras.lua save.

Usage: python -I wa_list.py <WeakAuras.lua or ForeverAuras.lua> [--json out.json]
"""
import json
import re
import sys

TOKEN = re.compile(
    r'\s+|--\[(=*)\[.*?\]\1\]|--[^\n]*|"((?:\\.|[^"\\])*)"|\[(=*)\[(.*?)\]\3\]'
    r'|(-?\d+\.?\d*(?:[eE][-+]?\d+)?)|(\{|\}|\[|\]|=|,|;)|([A-Za-z_][A-Za-z0-9_]*)',
    re.S,
)

ESC = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "\n": "\n", "a": "\a", "b": "\b", "f": "\f", "v": "\v"}


def unescape(s):
    """Undo Lua string escapes. A \\ddd escape is one byte, so a run of them can spell one UTF-8 character."""
    if "\\" not in s:
        return s
    out, i = bytearray(), 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            n = s[i + 1]
            if n.isdigit():
                j = i + 1
                while j < len(s) and j < i + 4 and s[j].isdigit():
                    j += 1
                out.append(int(s[i + 1:j]))
                i = j
                continue
            out += (ESC[n] if n in ESC else n).encode("utf-8")
            i += 2
            continue
        out += c.encode("utf-8")
        i += 1
    try:
        return out.decode("utf-8")
    except UnicodeDecodeError:
        return out.decode("latin-1")


def tokens(text):
    pos = 0
    n = len(text)
    while pos < n:
        m = TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"bad token at {pos}: {text[pos:pos+40]!r}")
        pos = m.end()
        if m.group(2) is not None:
            yield ("str", unescape(m.group(2)))
        elif m.group(4) is not None:
            yield ("str", m.group(4).lstrip("\n"))
        elif m.group(5) is not None:
            v = m.group(5)
            yield ("num", float(v) if any(ch in v for ch in ".eE") else int(v))
        elif m.group(6) is not None:
            yield ("p", m.group(6))
        elif m.group(7) is not None:
            w = m.group(7)
            if w == "true":
                yield ("val", True)
            elif w == "false":
                yield ("val", False)
            elif w == "nil":
                yield ("val", None)
            else:
                yield ("name", w)


class Parser:
    def __init__(self, text):
        self.toks = list(tokens(text))
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def take(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def value(self):
        k, v = self.take()
        if k in ("str", "num", "val"):
            return v
        if (k, v) == ("p", "{"):
            return self.table()
        raise ValueError(f"unexpected {k} {v!r}")

    def table(self):
        arr, d = [], {}
        while True:
            k, v = self.peek()
            if (k, v) == ("p", "}"):
                self.take()
                break
            if (k, v) == ("p", "["):
                self.take()
                key = self.value()
                self.take()  # ]
                self.take()  # =
                d[key] = self.value()
            elif k == "name" and self.toks[self.i + 1] == ("p", "="):
                self.take()
                self.take()
                d[v] = self.value()
            else:
                arr.append(self.value())
            if self.peek() in (("p", ","), ("p", ";")):
                self.take()
        if arr and not d:
            return arr
        for idx, item in enumerate(arr, 1):
            d[idx] = item
        return d

    def assignments(self):
        out = {}
        while self.i < len(self.toks):
            k, name = self.take()
            if k != "name":
                continue
            self.take()  # =
            out[name] = self.value()
        return out


def displays_of(saved, path=""):
    """The displays table of a parsed WeakAuras.lua or ForeverAuras.lua save."""
    for key in ("WeakAurasSaved", "ForeverAurasSaved"):
        if key in saved:
            return saved[key]["displays"]
    raise SystemExit(f"no WeakAurasSaved or ForeverAurasSaved in {path}")


def main():
    path = sys.argv[1]
    with open(path, encoding="utf-8", errors="replace") as f:
        data = Parser(f.read()).assignments()
    displays = displays_of(data, path)
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(displays, f, default=str)

    def count(aid):
        d = displays.get(aid) or {}
        kids = d.get("controlledChildren") or []
        if isinstance(kids, dict):
            kids = list(kids.values())
        return sum(1 + count(c) for c in kids)

    rows = []
    for aid, d in displays.items():
        if d.get("parent"):
            continue
        rows.append((aid, d.get("regionType"), count(aid), d.get("url") or ""))
    rows.sort(key=lambda r: r[0].lower())
    print(f"{len(displays)} auras, {len(rows)} top level")
    for aid, rt, n, url in rows:
        print(f"  {aid}  [{rt}{', ' + str(n) + ' inside' if n else ''}]  {url}")


if __name__ == "__main__":
    main()
