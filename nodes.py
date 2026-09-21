"""
nodes.py
Two nodes:
  1) LoraStackInputLoader - "Load LoRA (StackInput)". A pure hub: ONLY model, clip
                             and lora_stack. It applies every LoRA entry it receives
                             on lora_stack to model/clip and outputs the result. It
                             does not pick a LoRA itself.
  2) LoraStackContainer5  - "LoRA Stack Container". A pure data node: it does NOT
                             touch MODEL/CLIP at all. It only collects settings from
                             its 5 slots (lora + weights + on/off) and packs them into
                             a LORA_STACK list. It also has an optional lora_stack
                             input so you can chain another LoRA Stack Container into
                             it (to go past 5 loras), and merges that stack in too.
                             The output lora_stack is meant to be plugged into
                             LoraStackInputLoader, which is what actually applies it.
"""

import comfy.sd
import comfy.utils
import folder_paths

from .lora_utils import extract_trigger_words


def _lora_list():
    names = folder_paths.get_filename_list("loras")
    return ["None"] + names


def _apply_lora(model, clip, lora_name, strength_model, strength_clip):
    """Load one .safetensors LoRA file and apply it to model/clip. Returns (model, clip)."""
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if not lora_path:
        print(f"[LoraStackPack] LoRA not found, skipping: {lora_name}")
        return model, clip
    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
    return comfy.sd.load_lora_for_models(model, clip, lora, strength_model, strength_clip)


# ---------------------------------------------------------------------------
# Node 1: pure hub - only model/clip/lora_stack, applies the whole stack
# ---------------------------------------------------------------------------
class LoraStackInputLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            },
            "optional": {
                "lora_stack": ("LORA_STACK",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "load"
    CATEGORY = "loaders/lora_stack"

    def load(self, model, clip, lora_stack=None):
        m, c = model, clip
        if lora_stack:
            for lora_name, sm, sc in lora_stack:
                m, c = _apply_lora(m, c, lora_name, sm, sc)
        return (m, c)


# ---------------------------------------------------------------------------
# Node 2: pure data container - collects settings only, never touches MODEL/CLIP
# ---------------------------------------------------------------------------
NUM_SLOTS = 5


class LoraStackContainer5:
    @classmethod
    def INPUT_TYPES(cls):
        loras = _lora_list()
        required = {}
        for i in range(1, NUM_SLOTS + 1):
            required[f"slot{i}_enabled"] = ("BOOLEAN", {"default": i == 1})
            required[f"slot{i}_lora_name"] = (loras,)
            required[f"slot{i}_strength_model"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})
            required[f"slot{i}_strength_clip"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})
        return {
            "required": required,
            "optional": {
                # plug in another LoRA Stack Container (or a LoraStackInputLoader's
                # trigger chain) here to combine more than 5 loras
                "lora_stack": ("LORA_STACK",),
            },
        }

    RETURN_TYPES = ("LORA_STACK", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = (
        "lora_stack",
        "trigger_words_1",
        "trigger_words_2",
        "trigger_words_3",
        "trigger_words_4",
        "trigger_words_5",
    )
    FUNCTION = "build"
    CATEGORY = "loaders/lora_stack"

    def build(self, lora_stack=None, **kwargs):
        # start from whatever an upstream container passed in, so containers
        # can be chained together
        stack = list(lora_stack) if lora_stack else []
        triggers = []

        for i in range(1, NUM_SLOTS + 1):
            enabled = kwargs.get(f"slot{i}_enabled", False)
            lora_name = kwargs.get(f"slot{i}_lora_name", "None")
            sm = kwargs.get(f"slot{i}_strength_model", 1.0)
            sc = kwargs.get(f"slot{i}_strength_clip", 1.0)

            if lora_name and lora_name != "None":
                triggers.append(extract_trigger_words(lora_name))
            else:
                triggers.append("")

            if enabled and lora_name and lora_name != "None" and (sm != 0 or sc != 0):
                stack.append((lora_name, sm, sc))

        return (stack, *triggers)


# ---------------------------------------------------------------------------
# Node 3: Trigger Filter - up to 5 STRING inputs -> 1 STRING output. None of
# the 5 inputs are required to be connected; it works fine with just one.
# A word that appears (case-insensitively) in MORE THAN ONE of the connected
# inputs is dropped entirely; only words that occur exactly once anywhere
# across the connected inputs make it into the output. Sort order is
# controlled by the "sort_mode" widget, which the JS side hides and drives
# through a small settings popup.
# ---------------------------------------------------------------------------
class LoraTriggerFilter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sort_mode": (["frequency_order", "alphabetical"], {"default": "frequency_order"}),
            },
            "optional": {
                "word_list_1": ("STRING", {"forceInput": True, "default": ""}),
                "word_list_2": ("STRING", {"forceInput": True, "default": ""}),
                "word_list_3": ("STRING", {"forceInput": True, "default": ""}),
                "word_list_4": ("STRING", {"forceInput": True, "default": ""}),
                "word_list_5": ("STRING", {"forceInput": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filtered_words",)
    FUNCTION = "filter_words"
    CATEGORY = "loaders/lora_stack"

    def filter_words(self, sort_mode, word_list_1="", word_list_2="", word_list_3="",
                      word_list_4="", word_list_5=""):
        counts = {}
        first_seen_order = []
        display_form = {}

        for text in (word_list_1, word_list_2, word_list_3, word_list_4, word_list_5):
            if not text:
                continue
            for raw in text.split(","):
                word = raw.strip()
                if not word:
                    continue
                key = word.lower()
                if key not in counts:
                    counts[key] = 0
                    first_seen_order.append(key)
                    display_form[key] = word
                counts[key] += 1

        unique_keys = [k for k in first_seen_order if counts[k] == 1]

        if sort_mode == "alphabetical":
            unique_keys.sort(key=lambda k: display_form[k].lower())
        # "frequency_order" -> keep first-seen order as-is: each incoming
        # trigger_words_N string already lists tags most-to-least training
        # images, so preserving order approximates that ranking.

        result = ", ".join(display_form[k] for k in unique_keys)
        return (result,)


NODE_CLASS_MAPPINGS = {
    "LoraStackInputLoader": LoraStackInputLoader,
    "LoraStackContainer5": LoraStackContainer5,
    "LoraTriggerFilter": LoraTriggerFilter,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoraStackInputLoader": "Load LoRA (StackInput)",
    "LoraStackContainer5": "LoRA Stack Container",
    "LoraTriggerFilter": "Trigger Filter",
}
