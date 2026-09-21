from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

# ---------------------------------------------------------------------------
# Backend API route used by the frontend "gear" button to fetch trigger
# words / metadata for a LoRA without running the workflow.
#   GET /lora_stack_pack/info?lora_name=xyz.safetensors
# ---------------------------------------------------------------------------
try:
    from server import PromptServer
    from aiohttp import web
    import asyncio
    import functools

    from .lora_utils import get_lora_full_info, save_user_notes

    @PromptServer.instance.routes.get("/lora_stack_pack/info")
    async def lora_stack_pack_info(request):
        lora_name = request.rel_url.query.get("lora_name", "")
        full = request.rel_url.query.get("full", "0") in ("1", "true", "True")
        if not lora_name or lora_name == "None":
            return web.json_response({
                "name": "", "base_model": "", "clip_skip": "", "resolution": "",
                "notes": "", "download_url": None, "civitai_url": None, "civitai_label": "",
                "preview_image": None, "tags": [], "total_tags": 0,
                "trained_words": [], "user_notes": "", "raw_metadata": {},
                "error": "No LoRA selected.",
            })
        # hashing a large LoRA file + the live Civitai lookup can take a
        # moment, so run it off the main event loop instead of blocking the
        # whole ComfyUI server while the popup waits for it
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, functools.partial(get_lora_full_info, lora_name, full=full))
        return web.json_response(data)

    @PromptServer.instance.routes.post("/lora_stack_pack/notes")
    async def lora_stack_pack_save_notes(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON body."}, status=400)
        lora_name = body.get("lora_name", "")
        notes = body.get("notes", "")
        ok, err = save_user_notes(lora_name, notes)
        return web.json_response({"ok": ok, "error": err})

except Exception as e:  # pragma: no cover - only fails outside a real ComfyUI server
    print(f"[LoraStackPack] Could not register API route: {e}")
