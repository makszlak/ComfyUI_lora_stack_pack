"""
lora_utils.py
Helpers for reading LoRA (.safetensors) metadata directly from the file header,
plus optional sidecar files placed next to the .safetensors by common
LoRA-organizing tools (a Civitai-info JSON, a preview image, and our own
user-notes text file), so the info popup can show as much as possible: name,
base model, notes (+ a download-source link + user-editable free text),
preview image (local file OR a remote URL), Trained Words, and the FULL
tag/trigger-word frequency table.

IMPORTANT: a plain kohya_ss-trained .safetensors file's own metadata does NOT
contain trigger words, a preview image, or a real "where did this come from"
link — it only has training parameters (ss_*) and a generic modelspec.*
block. Those richer fields only exist if either (a) a Civitai-style sidecar
JSON is sitting next to the file, or (b) we fetch them live from Civitai's
public API using the file's own SHA256 hash, which works for ANY LoRA that
was ever uploaded to Civitai, sidecar file or not.
"""

import os
import re
import json
import base64
import struct
import hashlib
import urllib.request
import urllib.error

import folder_paths

_PREVIEW_EXTS = [".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
                  ".png", ".jpg", ".jpeg", ".webp"]
_MIME_BY_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
_MAX_PREVIEW_BYTES = 6 * 1024 * 1024  # don't inline huge images
_URL_RE = re.compile(r"https?://[^\s\"'<>]+")

# metadata keys that always contain a generic framework/spec URL, never a
# real "where this specific model came from" link — never treat these as a
# download source
_URL_SCAN_KEY_BLACKLIST = {"modelspec.implementation", "modelspec.sai_model_spec"}

# candidate filenames for a Civitai-style sidecar JSON, tried in this order
_CIVITAI_SIDECAR_SUFFIXES = [".civitai.info", ".civitai.info.json", ".json"]

_CIVITAI_API_TIMEOUT = 8  # seconds
_CIVITAI_HASH_LOOKUP_URL = "https://civitai.com/api/v1/model-versions/by-hash/{}"

_hash_cache = {}      # lora_path -> (mtime, size, sha256_hex)
_civitai_api_cache = {}  # sha256_hex -> parsed API response dict, or None (cached miss)


def _resolve_lora_path(lora_name):
    if not lora_name or lora_name == "None":
        return None
    path = folder_paths.get_full_path("loras", lora_name)
    if not path or not os.path.exists(path):
        return None
    return path


def _read_safetensors_header(path):
    """Read only the JSON header of a .safetensors file (fast, no tensor data)."""
    with open(path, "rb") as f:
        header_len_bytes = f.read(8)
        if len(header_len_bytes) < 8:
            return {}
        header_len = struct.unpack("<Q", header_len_bytes)[0]
        header_json = f.read(header_len)
        try:
            header = json.loads(header_json)
        except Exception:
            return {}
        return header.get("__metadata__", {}) or {}


def _sidecar_path(lora_path, suffix):
    base, _ext = os.path.splitext(lora_path)
    return base + suffix


def _sha256_of_file(path):
    """SHA256 of the whole file, cached by (mtime, size) so we don't re-hash
    a large LoRA file on every popup open — only when it actually changes."""
    try:
        stat = os.stat(path)
        cached = _hash_cache.get(path)
        if cached and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
            return cached[2]
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        digest = h.hexdigest()
        _hash_cache[path] = (stat.st_mtime, stat.st_size, digest)
        return digest
    except Exception as e:
        print(f"[LoraStackPack] Failed hashing '{path}': {e}")
        return None


def _fetch_civitai_by_hash(sha256_hex):
    """Live lookup against Civitai's public 'model-versions/by-hash' API —
    works for ANY LoRA that was ever uploaded to Civitai, no sidecar file
    needed. Requires the machine running ComfyUI to have internet access.
    Result is cached in memory (including negative/failed lookups) so we
    don't hit the network again for the same file this session."""
    if not sha256_hex:
        return None
    if sha256_hex in _civitai_api_cache:
        return _civitai_api_cache[sha256_hex]
    url = _CIVITAI_HASH_LOOKUP_URL.format(sha256_hex)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-LoraStackPack/1.0"})
        with urllib.request.urlopen(req, timeout=_CIVITAI_API_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        _civitai_api_cache[sha256_hex] = data
        return data
    except Exception as e:
        print(f"[LoraStackPack] Civitai hash lookup failed for {sha256_hex[:12]}...: {e}")
        _civitai_api_cache[sha256_hex] = None
        return None


def _first(*values):
    for v in values:
        if v:
            return v
    return None


def _extract_trained_words(data):
    """Trained-word lists show up under different keys depending on which
    downloader tool wrote the sidecar JSON — check all the shapes we know of:
    top-level 'trainedWords', nested under 'model', or under the first entry
    of a 'modelVersions' array (the shape of Civitai's own /models API)."""
    if not isinstance(data, dict):
        return []
    candidates = [data.get("trainedWords")]
    model = data.get("model")
    if isinstance(model, dict):
        candidates.append(model.get("trainedWords"))
    model_versions = data.get("modelVersions")
    if isinstance(model_versions, list) and model_versions and isinstance(model_versions[0], dict):
        candidates.append(model_versions[0].get("trainedWords"))
    for c in candidates:
        if c:
            return list(c) if isinstance(c, list) else [str(c)]
    return []


def _extract_remote_preview_url(data):
    """If the sidecar JSON references example images (Civitai's own API shape
    always includes an 'images' array with hosted URLs), use the first one as
    a fallback preview when there's no local preview file next to the LoRA."""
    if not isinstance(data, dict):
        return None
    for images in (data.get("images"), (data.get("model") or {}).get("images")):
        if isinstance(images, list):
            for img in images:
                if isinstance(img, dict) and img.get("url"):
                    return img["url"]
    model_versions = data.get("modelVersions")
    if isinstance(model_versions, list) and model_versions and isinstance(model_versions[0], dict):
        images = model_versions[0].get("images")
        if isinstance(images, list):
            for img in images:
                if isinstance(img, dict) and img.get("url"):
                    return img["url"]
    return None


def _find_civitai_sidecar_path(lora_path):
    for suffix in _CIVITAI_SIDECAR_SUFFIXES:
        candidate = _sidecar_path(lora_path, suffix)
        if not os.path.exists(candidate):
            continue
        try:
            with open(candidate, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        # a plain "<name>.json" is only trusted as a civitai-style sidecar if
        # it actually looks like one, so we don't misread unrelated json files
        if suffix == ".json" and not isinstance(data, dict):
            continue
        if suffix == ".json" and not any(k in data for k in ("trainedWords", "modelId", "modelVersions", "baseModel")):
            continue
        return candidate, data
    return None, None


def _read_civitai_sidecar(lora_path):
    """Look for a Civitai-style sidecar JSON placed next to the LoRA first
    (fast, offline, respects any file a manager already downloaded). If none
    exists, fall back to a LIVE Civitai lookup by the file's own SHA256 hash
    — this is what makes Notes / Trained Words / preview work for ANY LoRA,
    not just ones that already have a sidecar file. A successful live lookup
    is cached to a local '.civitai.info' file so future opens are instant
    and work offline too."""
    _path, data = _find_civitai_sidecar_path(lora_path)

    if not data:
        sha256_hex = _sha256_of_file(lora_path)
        data = _fetch_civitai_by_hash(sha256_hex)
        if data:
            cache_path = _sidecar_path(lora_path, ".civitai.info")
            if not os.path.exists(cache_path):
                try:
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(data, f)
                except Exception as e:
                    print(f"[LoraStackPack] Could not cache Civitai info next to LoRA: {e}")

    if not data:
        return {}

    model = data.get("model", {}) or {}
    model_versions = data.get("modelVersions") or []
    first_version = model_versions[0] if (model_versions and isinstance(model_versions[0], dict)) else {}

    model_id = _first(data.get("modelId"), model.get("id"), data.get("id") if model_versions else None)
    version_id = _first(data.get("id") if not model_versions else None, first_version.get("id"))
    civitai_url = None
    if model_id:
        civitai_url = f"https://civitai.com/models/{model_id}"
        if version_id:
            civitai_url += f"?modelVersionId={version_id}"

    notes = _first(data.get("description"), model.get("description"), first_version.get("description")) or ""
    if notes:
        notes = re.sub(r"<[^>]+>", " ", notes)  # strip html tags
        notes = re.sub(r"\s+", " ", notes).strip()

    return {
        "name": _first(data.get("name"), model.get("name")) or "",
        "base_model": _first(data.get("baseModel"), first_version.get("baseModel")) or "",
        "notes": notes,
        "civitai_url": civitai_url,
        "civitai_label": _first(model.get("name"), data.get("name")) or "View on Civitai",
        "trained_words": _extract_trained_words(data),
        "remote_preview_url": _extract_remote_preview_url(data),
    }


def _find_download_url(meta, civitai_url):
    """Best-effort discovery of a 'where this was downloaded from' link, for
    the Notes field. Prefers the Civitai page URL if we already have one
    (from a sidecar file or the live hash lookup); otherwise scans the raw
    .safetensors metadata values for anything that looks like a URL — but
    skips known generic framework/spec fields (e.g. modelspec.implementation
    always points at the training framework's GitHub repo, not the model)."""
    if civitai_url:
        return civitai_url
    candidates = []
    for key, value in (meta or {}).items():
        if key in _URL_SCAN_KEY_BLACKLIST:
            continue
        if not isinstance(value, str):
            continue
        m = _URL_RE.search(value)
        if m:
            candidates.append((key, m.group(0)))
    if not candidates:
        return None
    for key, url in candidates:
        lk = key.lower()
        if any(hint in lk for hint in ("url", "source", "link", "resource", "download")):
            return url
    return candidates[0][1]


def _notes_sidecar_path(lora_path):
    return _sidecar_path(lora_path, ".stacknotes.txt")


def get_user_notes(lora_name):
    """Our own free-text notes the user typed in and saved via the popup's
    Notes editor — stored in a plain-text sidecar we create ourselves."""
    path = _resolve_lora_path(lora_name)
    if not path:
        return ""
    notes_path = _notes_sidecar_path(path)
    if not os.path.exists(notes_path):
        return ""
    try:
        with open(notes_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def save_user_notes(lora_name, notes):
    path = _resolve_lora_path(lora_name)
    if not path:
        return False, "LoRA file not found."
    notes_path = _notes_sidecar_path(path)
    try:
        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(notes or "")
        return True, None
    except Exception as e:
        return False, str(e)


def _find_preview_image(lora_path):
    base, _ext = os.path.splitext(lora_path)
    for ext in _PREVIEW_EXTS:
        candidate = base + ext
        if os.path.exists(candidate):
            try:
                if os.path.getsize(candidate) > _MAX_PREVIEW_BYTES:
                    continue
                mime = None
                for known_ext, known_mime in _MIME_BY_EXT.items():
                    if candidate.lower().endswith(known_ext):
                        mime = known_mime
                        break
                if not mime:
                    continue
                with open(candidate, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                return f"data:{mime};base64,{b64}"
            except Exception:
                continue
    return None


DEFAULT_TAG_LIMIT = 200  # default cap shown in the popup / used by the node output;
                          # the popup also offers a "show all" button that bypasses this


def _all_tag_frequency(lora_name):
    """Full, untruncated list of {tag, count}, aggregated across all ss_tag_frequency
    dataset buckets, sorted by count descending (most training images first)."""
    path = _resolve_lora_path(lora_name)
    if not path:
        return []
    try:
        meta = _read_safetensors_header(path)
        tag_freq_raw = meta.get("ss_tag_frequency")
        if not tag_freq_raw:
            return []
        tag_freq = json.loads(tag_freq_raw)
        combined = {}
        for dataset_tags in tag_freq.values():
            for tag, freq in dataset_tags.items():
                combined[tag] = combined.get(tag, 0) + freq
        sorted_tags = sorted(combined.items(), key=lambda kv: -kv[1])
        return [{"tag": t, "count": c} for t, c in sorted_tags]
    except Exception as e:
        print(f"[LoraStackPack] Failed reading tag frequency for '{lora_name}': {e}")
        return []


def get_tag_frequency_list(lora_name, limit=DEFAULT_TAG_LIMIT):
    """{tag, count} list, sorted by count descending (most training images first),
    capped at `limit` (pass limit=None for the full, untruncated list)."""
    all_tags = _all_tag_frequency(lora_name)
    if limit is None:
        return all_tags
    return all_tags[:limit]


def get_trained_words(lora_name):
    """Trained/trigger words from whichever source has them: a Civitai-style
    sidecar JSON first, then explicit fields some converters embed directly
    in the .safetensors metadata (trigger_words / modelspec.trigger_phrase /
    ss_trigger_words / trained_words)."""
    path = _resolve_lora_path(lora_name)
    if not path:
        return []
    civitai = _read_civitai_sidecar(path)
    if civitai.get("trained_words"):
        return civitai["trained_words"]

    meta = _read_safetensors_header(path)
    for key in ("trigger_words", "modelspec.trigger_phrase", "ss_trigger_words", "trained_words"):
        val = meta.get(key)
        if val:
            if isinstance(val, (list, tuple)):
                return list(val)
            return [w.strip() for w in str(val).split(",") if w.strip()]
    return []


def extract_trigger_words(lora_name):
    """Comma-separated string of the top DEFAULT_TAG_LIMIT tags/trigger words
    for this LoRA — the exact same data and cut-off the info popup shows by
    default, sorted from most to least training images."""
    tags = get_tag_frequency_list(lora_name)
    if tags:
        return ", ".join(t["tag"] for t in tags)
    trained = get_trained_words(lora_name)
    if trained:
        return ", ".join(trained)
    return ""


def get_lora_full_info(lora_name, full=False):
    """Everything the info popup needs, in one call.
    full=True bypasses DEFAULT_TAG_LIMIT and returns every known tag."""
    path = _resolve_lora_path(lora_name)
    if not path:
        return {
            "name": lora_name, "base_model": "", "clip_skip": "", "resolution": "",
            "notes": "", "download_url": None, "civitai_url": None, "civitai_label": "",
            "preview_image": None, "tags": [], "total_tags": 0, "trained_words": [],
            "user_notes": "", "raw_metadata": {}, "error": "File not found.",
        }

    meta = _read_safetensors_header(path)
    civitai = _read_civitai_sidecar(path)
    all_tags = _all_tag_frequency(lora_name)
    tags = all_tags if full else all_tags[:DEFAULT_TAG_LIMIT]

    preview = _find_preview_image(path) or civitai.get("remote_preview_url")

    base_model = (
        civitai.get("base_model")
        or meta.get("ss_base_model_version")
        or meta.get("modelspec.architecture")
        or ""
    )
    resolution = meta.get("ss_resolution") or ""
    clip_skip = meta.get("ss_clip_skip") or ""
    notes = civitai.get("notes") or meta.get("modelspec.description") or ""
    name = civitai.get("name") or meta.get("ss_output_name") or os.path.splitext(os.path.basename(path))[0]

    trained_words = get_trained_words(lora_name)
    if not tags and trained_words:
        # only fall back to using them as the tag grid if there's truly no
        # frequency data at all
        tags = [{"tag": w, "count": None} for w in trained_words]

    download_url = _find_download_url(meta, civitai.get("civitai_url"))

    return {
        "name": name,
        "base_model": str(base_model),
        "clip_skip": str(clip_skip),
        "resolution": str(resolution),
        "notes": notes,
        "download_url": download_url,
        "civitai_url": civitai.get("civitai_url"),
        "civitai_label": civitai.get("civitai_label") or "",
        "preview_image": preview,
        "tags": tags,
        "total_tags": len(all_tags),
        "trained_words": trained_words,
        "user_notes": get_user_notes(lora_name),
        "raw_metadata": meta,
        "error": None,
    }
