"""Shared helpers for porting WeakAuras to ForeverAuras (WoW Forever).

Load it from a build script in a sibling folder:

    spec = importlib.util.spec_from_file_location("fa_port", os.path.join(HERE, "..", "tools", "fa_port.py"))
    fa = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fa)
"""
import hashlib
import importlib.util
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("wa_list", os.path.join(HERE, "wa_list.py"))
assert _spec and _spec.loader
wa_list = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wa_list)

FOREVER_TOC = 16001
# Wago and update fields that tie an aura to its Classic original. Drop them from a port.
WAGO_KEYS = ("url", "wagoID", "version", "semver", "preferToUpdate", "source")
UID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789()"


# --- Reading saves -------------------------------------------------------------------------------

def load_displays(path):
    """Every aura in a WeakAuras.lua or ForeverAuras.lua save, or in a snapshot written by write_snapshot."""
    with open(path, encoding="utf-8", errors="replace") as f:
        return wa_list.displays_of(wa_list.Parser(f.read()).assignments(), path)


def children_of(aura):
    kids = aura.get("controlledChildren") or []
    if isinstance(kids, dict):
        kids = [kids[k] for k in sorted(kids)]
    return kids


def group_members(displays, root):
    """The group's id, then every aura inside it, depth first."""
    out = [root]
    for kid in children_of(displays[root]):
        out.extend(group_members(displays, kid))
    return out


# --- Building ------------------------------------------------------------------------------------

def uid_for(namespace, aura_id):
    """The same uid on every rebuild, so importing a newer build offers to update the old one."""
    digest = hashlib.sha256((namespace + ":" + aura_id).encode()).digest()
    return "".join(UID_CHARS[b % 64] for b in digest[:11])


TEXTURE_PATH = re.compile(r"^Interface\\Add[oO]ns\\WeakAuras\\")


def fix_textures(node):
    """Point WeakAuras texture paths at ForeverAuras' copies, which have the same file names.
    ForeverAuras' importer only rewrites sound paths."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str) and TEXTURE_PATH.match(v):
                node[k] = TEXTURE_PATH.sub(r"Interface\\AddOns\\ForeverAuras\\", v)
            else:
                fix_textures(v)
    elif isinstance(node, list):
        for v in node:
            fix_textures(v)


def normalize_triggers(aura):
    """A triggers table with no named keys comes out of the parser as a 0-based list."""
    trig = aura.get("triggers")
    if isinstance(trig, list):
        aura["triggers"] = {i + 1: t for i, t in enumerate(trig)}


def entry(trigger, untrigger=None):
    return {"trigger": trigger, "untrigger": untrigger or {}}


ADDON_VERSION = "1.3.2"  # the ForeverAuras version new ports are built against


def finish_aura(aura, drop=()):
    """Ready an aura for a ForeverAuras import: no Wago link (Wago would offer to "update" it back to the
    original), Forever's TOC and ForeverAuras texture paths. Keep its id and uid so an import updates the
    installed copy in place."""
    for key in WAGO_KEYS + tuple(drop):
        aura.pop(key, None)
    fix_textures(aura)
    aura["tocversion"] = FOREVER_TOC
    return aura


def transmit(aura, children=None, version=ADDON_VERSION):
    """The table inside an import string."""
    t = {"m": "d", "d": aura, "v": 2000, "s": version}
    if children:
        t["c"] = children
    return t


def build_main(port, here, default_src, default_out):
    """The command line every build.py shares: build.py [source.lua] [out.lua]."""
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, default_src)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, default_out)
    t = port(load_displays(src))
    write_transmit(out, t, os.path.basename(here) + "/build.py")
    n = len(t.get("c") or [])
    print(f"wrote {out}: {t['d']['id']}" + (f" + {n} auras" if n else ""))


# --- Writing Lua ---------------------------------------------------------------------------------

LUA_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
LUA_RESERVED = set("and break do else elseif end false for function goto if in local nil not or repeat "
                   "return then true until while".split())


def lua_str(s, raw_utf8=False):
    """A Lua string literal. Non-ASCII text is written as byte escapes unless raw_utf8 is set."""
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif 32 <= o < 127 or (raw_utf8 and o >= 128):
            out.append(ch)
        else:
            out.extend("\\%03d" % b for b in ch.encode("utf-8"))
    out.append('"')
    return "".join(out)


def lua_val(v, depth=0, raw_utf8=False):
    if v is None:
        return "nil"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v) if v == v and v not in (float("inf"), float("-inf")) else "0"
    if isinstance(v, str):
        return lua_str(v, raw_utf8)
    pad = "  " * (depth + 1)
    if isinstance(v, list):
        if not v:
            return "{}"
        return "{\n" + "".join(f"{pad}{lua_val(x, depth + 1, raw_utf8)},\n" for x in v) + "  " * depth + "}"
    if isinstance(v, dict):
        if not v:
            return "{}"
        parts = []
        for k in sorted(v, key=lambda k: (isinstance(k, str), str(k) if isinstance(k, str) else k)):
            if isinstance(k, str):
                key = k if LUA_KEY.match(k) and k not in LUA_RESERVED else f"[{lua_str(k, raw_utf8)}]"
            else:
                key = f"[{k}]"
            parts.append(f"{pad}{key} = {lua_val(v[k], depth + 1, raw_utf8)},\n")
        return "{\n" + "".join(parts) + "  " * depth + "}"
    raise TypeError(type(v))


def write_transmit(path, transmit, generator):
    """Write the export table as Lua source, for encode.mjs and the tests to load."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"-- Generated by {generator}. The export table for ForeverAuras' importer.\n")
        f.write("return " + lua_val(transmit) + "\n")


def write_snapshot(path, displays, ids, note):
    """Save some auras in the same form as a WeakAuras.lua save, so load_displays reads them back exactly."""
    subset = {aid: displays[aid] for aid in ids}
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for line in note.splitlines():
            f.write(f"-- {line}\n".replace("-- \n", "--\n"))
        f.write("WeakAurasSaved = " + lua_val({"displays": subset}, raw_utf8=True) + "\n")
