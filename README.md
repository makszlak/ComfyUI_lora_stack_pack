[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/A0A51HRY6J)

| **LoRA Stack Container** | Collects a selection of 5 LoRAs (+ weights) into one `LORA_STACK`. Applies nothing to the model—only the data. |
| **Load LoRA (StackInput)** | Takes `model`, `clip`, `lora_stack` and applies the entire stack. The only note touching the model. |
| **Trigger Filter** | Accepts trigger words from container(s), removes duplicates,
returns one ready-made line for the prompt. |


===========================================================================================

## 1. LoRA Stack Container - `LoraStackContainer5`

<img width="407" height="1291" alt="{9CC3DAA6-9B3F-4F1B-80DF-5EE8EB165873}" src="https://github.com/user-attachments/assets/e8210738-deb5-4534-981c-96b964baf3b6" />

Noda-container for 5 slots. Each slot has 4 lines, with an empty line
between slots:
1. Compact tumbler `slotN_enabled` (standard view of ComfyUI).
2. **⚙ Slot N Info** button — opens a pop-up with complete information about
   selected LoRA (description below).
3. Select LoRA — `slotN_lora_name`.
4.
`slotN_strength_model`.
5. `slotN_strength_clip`.

**Inputs:** `lora_stack` (optional) - Connect the output of another here
container to combine more than 5 LoRAs into one stack.

**Outputs:**
- `lora_stack` — combined stack, to be passed to `Load LoRA (StackInput)`.
- `trigger_words_1` … `trigger_words_5` — one per slot, typ
`LORA_TRIGGER_WORDS` (only compatible with nodes of this pack, normal
  It is physically impossible to connect `STRING'). Each line is a **complete** list
  tags of this LoRA (without clipping), sorted by decreasing number
  training images, and always ends with a comma ("cat, dog, blue eyes,"`)
— so that when several such lines are connected in a row, the last tag of one is not
  merged with the first tag of the next one.


===========================================================================================

## 2. Load LoRA (StackInput) — `LoraStackInputLoader`

<img width="1091" height="799" alt="{B55EC2FD-45E1-4DAB-906E-C71226E71BF1}" src="https://github.com/user-attachments/assets/35fc8737-d9d0-4f0b-8e11-94b54e519cf2" />

 The only purpose is to apply the stack to the model.

**Inputs:**
- `model`, `clip` are mandatory.
- `lora_stack' is optional; if empty, node just skips `model`/`clip`
  unchanged (except for the CLIP layer, see below).
- `stop_at_clip_layer` is an integer `-1..-24` (as in standard ComfyUI
  CLIPSetLastLayer node), default is `-1`.
Applies to `clip`
  always, whether `lora_stack` is connected or not.

A node does not have its own LoRA selection — all selection is done in the Container(s). 

===========================================================================================

## 3. Trigger Filter - `LoraTriggerFilter`

<img width="977" height="705" alt="{F506E4F1-9261-4234-8041-D3E2211DCF38}" src="https://github.com/user-attachments/assets/9c186151-5506-4c96-94db-ef2c929d1f3e" />

<img width="1082" height="732" alt="{0196515E-8138-4991-8D57-1F69F6B6EFC6}" src="https://github.com/user-attachments/assets/9b00f22b-143e-4c12-8dd2-2e82d0cfb38e" />

Takes trigger words from one or more containers, removes duplicates, etc
adds your own words with priority.

**Inputs:**
- `trigger_words_1` … `trigger_words_5` (type `LORA_TRIGGER_WORDS`, optional) —
  are connected only from `trigger_words_N` outputs of `LoRA Stack nodes
  Container`.
None are required - noda works with even one.
- `extra_words` (ordinary `STRING`) — text field right at the foot, you can
  enter manually, or connect by wire from any text node,
  including the `filtered_words` of another Trigger Filter (filter chain).

**Output:** `filtered_words` is one finished string.

### Filtering logic
-
**`extra_words` has absolute priority.** Its words are processed
  first; if the same word occurs further among `trigger_words_1..5`,
  this later take is simply ignored.
- **Among `trigger_words_1..5`** is a simple string comparison without counting
  register A word that occurs in more than one place, completely
hides from the result (there is no option left). Reinforcement in
  styles `(tag:1.3)` are not recognized here - LoRA tags are always simple words
  without that syntax, they don't need that logic.

### Live preview without running Queue
Until the graph is run, the node's Python code has not yet executed—but the Trigger Filter has
holds the hidden service field `text`,
which updates itself:
as soon as you change the LoRA in the connected container or the text in `extra_words`,
the node in ~0.25 s turns to `POST /lora_stack_pack/filter` and receives
the same result that the real execution will give (the logic is shared,
`lora_utils.filter_tag_texts`, so they cannot diverge).

This allows third-party nodes,
which read the connected text widget
nodes live (for example, CLIP Text Encode mod with Tag Toggles Reader), see
tags without triggering generation.

If a wire is connected to the `extra_words` pin, the preview takes the text from the connected one
nodes, and not from their own field. Supported: node with text widget (`text`,
`string`, `value`, `prompt`,
`tags` or the first line field), pass through
Reroute, and another ``Trigger Filter'' (its live result is taken — yes
you can build chains).

**Limitations of live preview:**
- Only understands **direct** Container → Trigger Filter connections. If between
  they are other nodes — the preview is empty (the actual execution works at the same time
  as usual).
- Text,
which is only computed in Python at startup (does not lie in the
  no widget), is not visible in the editor.
- The `text' field is not saved in the workflow — it is recalculated when
  every discovery.


===========================================================================================

## Popup ⚙ Info

<img width="769" height="1172" alt="{06487E7A-69FD-46BE-A6A7-52303BF1714C}" src="https://github.com/user-attachments/assets/06ea2af5-698e-4a56-ba27-428768ca8fde" />

Opens with a button on each container slot. Shows everything that was successful
find about the selected LoRA.

**Top:**
- Name, Base Model, Clip Skip, Resolution.
- **Notes** — auto-detected source link (Civitai page, if
  found) + your own notes: button **✏ Edit** → text field →
**Save** saves them to a small sidecar file next to LoRA, notes
  experiencing a ComfyUI restart.
- **Preview image.** If several application images are found - sub
  a row of thumbnails appears as the main picture, a click switches the preview.
  The **"Use as preview"** button saves the selected image locally
  (`<name>.preview.
png/jpg/webp`) - since then it is always shown,
  without referring to the network. The old local image is deleted automatically.

**Tags:**
- The **search** field — the entered text highlights the match in yellow and
  mutes the rest, automatically scrolls to the first match.
- **Tag grid**, sorted by descending number of trainees
  images.
Default is top 200; if there are more tags - a button
  **"Show all (N)"** loads the full list.
- A separate field **Trained Words** is an official, curated list of trigger words
  from the sidecar file (if any), regardless of tag statistics from the dataset.
- **Copy Selected** / **Copy All** (a comma is added at the end of the copied
text) / **View raw metadata** / **Close**.

**Control:** is closed with the **Esc** key, a click outside the window or
with the Close button. Adapts to the size of the screen - completely scrolls as one
whole on small windows.

### Where do popup data come from?
A normal LoRA file (`.safetensors`) **does not contain** trigger words, images or
model references are technical training parameters only. These data
are taken in one of two ways:

1. **Local sidecar file** next to LoRA (`<name>.civitai.info`,
   `.civitai.info.json` or `.json`) - if the previous one left one
   LoRA manager.
2. **Live search on Civitai by file hash** if there is no sidecar file:
the node calculates the SHA256 of the entire file and asks
   `https://civitai.com/api/v1/model-versions/by-hash/<hash>`. The result
   cached in `<name>.civitai.info` next to the file - next time
   read instantly and offline.

Works for any LoRA that was once on Civitai. If LoRA is trained
locally and has never been published - there will be no data,
it is expected. The first
a new LoRA request requires Internet access and may take several
seconds (a pop-up shows a loading indicator).

**The numbers next to the tags** in the tag grid are the number of training images, in
signatures of which this tag occurred (data from `ss_tag_frequency`, which stores
kohya_ss coach himself right in the file).
