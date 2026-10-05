// NOTE: this file is served at /extensions/<custom_node_folder>/js/lora_stack_pack.js
// so we need THREE "../" to reach ComfyUI's web root /scripts/app.js.
import { app } from "../../../scripts/app.js";

// ---------------------------------------------------------------------------
// small shared modal helper
// ---------------------------------------------------------------------------
function openModal(builder) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        z-index: 10000; display: flex; align-items: center; justify-content: center;
    `;
    const box = document.createElement("div");
    box.style.cssText = `
        background: #1c1f26; color: #eee; border-radius: 10px; padding: 18px 22px;
        max-width: 760px; width: 92%; max-height: 85vh; overflow: auto;
        font-family: sans-serif; font-size: 13px; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
        display: flex; flex-direction: column; gap: 10px;
    `;
    const close = () => {
        if (overlay.parentNode) document.body.removeChild(overlay);
        document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (e) => {
        if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    builder(box, close);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
    return close;
}

// ---------------------------------------------------------------------------
// LoRA info popup (civitai-style panel)
// ---------------------------------------------------------------------------
async function fetchLoraInfo(loraName, full) {
    try {
        const res = await fetch(`/lora_stack_pack/info?lora_name=${encodeURIComponent(loraName)}${full ? "&full=1" : ""}`);
        return await res.json();
    } catch (e) {
        return { name: loraName, tags: [], total_tags: 0, trained_words: [], raw_metadata: {}, error: `Request failed: ${e}` };
    }
}

function showLoraInfoDialog(loraName, data) {
    const selected = new Set();
    let currentData = data;

    openModal((box, close) => {
        const rebuild = () => {
            box.innerHTML = "";

            const title = document.createElement("div");
            title.textContent = loraName;
            title.style.cssText = "font-weight: 700; font-size: 16px; word-break: break-all;";
            box.appendChild(title);

            if (currentData.error) {
                const err = document.createElement("div");
                err.textContent = currentData.error;
                err.style.cssText = "color: #f88;";
                box.appendChild(err);
            }

            const topRow = document.createElement("div");
            topRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;";

            const infoCol = document.createElement("div");
            infoCol.style.cssText = "flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 4px;";
            const addLine = (label, value) => {
                if (!value) return;
                const line = document.createElement("div");
                line.innerHTML = `<span style="opacity:0.65">${label}:</span> ${value}`;
                infoCol.appendChild(line);
            };
            addLine("Name", currentData.name);
            addLine("Base Model", currentData.base_model);
            addLine("Clip Skip", currentData.clip_skip);
            addLine("Resolution", currentData.resolution);
            if (currentData.civitai_url) {
                const link = document.createElement("div");
                const a = document.createElement("a");
                a.href = currentData.civitai_url;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.style.cssText = "color: #6cf;";
                a.textContent = currentData.civitai_label || "View on Civitai";
                link.appendChild(document.createTextNode("Civitai: "));
                link.appendChild(a);
                infoCol.appendChild(link);
            }
            topRow.appendChild(infoCol);

            // "selectedPreviewUrl" tracks whichever image is currently shown
            // as the big preview — starts as whatever the backend picked,
            // but the user can click a thumbnail below to switch it before
            // saving it as the permanent local preview.
            let selectedPreviewUrl = currentData.preview_image || null;

            if (selectedPreviewUrl) {
                const previewCol = document.createElement("div");
                previewCol.style.cssText = "display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: center;";

                const img = document.createElement("img");
                img.src = selectedPreviewUrl;
                img.style.cssText = "width: 180px; max-width: 100%; max-height: 260px; object-fit: cover; border-radius: 6px;";
                previewCol.appendChild(img);

                const candidates = currentData.preview_candidates || [];
                if (candidates.length > 0) {
                    const thumbRow = document.createElement("div");
                    thumbRow.style.cssText = "display: flex; gap: 4px; flex-wrap: wrap; max-width: 180px; justify-content: center;";
                    candidates.forEach((url) => {
                        const thumb = document.createElement("img");
                        thumb.src = url;
                        const isActive = url === selectedPreviewUrl;
                        thumb.style.cssText = `width: 34px; height: 34px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 2px solid ${isActive ? "#6cf" : "transparent"};`;
                        thumb.onclick = () => {
                            selectedPreviewUrl = url;
                            img.src = url;
                            thumbRow.querySelectorAll("img").forEach((t) => {
                                t.style.borderColor = t.src === url ? "#6cf" : "transparent";
                            });
                            useAsPreviewBtn.style.display = "inline-block";
                            useAsPreviewBtn.textContent = "Use as preview";
                        };
                        thumbRow.appendChild(thumb);
                    });
                    previewCol.appendChild(thumbRow);
                }

                // only useful when there's something to pick BETWEEN, or the
                // current one isn't saved locally yet
                const useAsPreviewBtn = document.createElement("button");
                useAsPreviewBtn.textContent = "Use as preview";
                useAsPreviewBtn.style.cssText = "padding: 4px 10px; cursor: pointer; background: #2a2e37; color: #eee; border: 1px solid #444; border-radius: 5px; font-size: 12px;";
                useAsPreviewBtn.style.display = (candidates.length > 0 || !currentData.preview_is_local) ? "inline-block" : "none";
                useAsPreviewBtn.onclick = async () => {
                    useAsPreviewBtn.textContent = "Saving...";
                    try {
                        const res = await fetch("/lora_stack_pack/set_preview", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lora_name: loraName, image_url: selectedPreviewUrl }),
                        });
                        const result = await res.json();
                        if (result.ok) {
                            useAsPreviewBtn.textContent = "✓ Saved";
                            currentData.preview_image = selectedPreviewUrl;
                            currentData.preview_is_local = true;
                        } else {
                            useAsPreviewBtn.textContent = "Save failed";
                        }
                    } catch (e) {
                        useAsPreviewBtn.textContent = "Save failed";
                    }
                };
                previewCol.appendChild(useAsPreviewBtn);

                topRow.appendChild(previewCol);
            }
            box.appendChild(topRow);

            // --- Notes: auto-detected download-source link (if any) + the
            // user's own free-text notes, editable and saved to a small
            // sidecar file next to the LoRA ---
            const notesHeaderRow = document.createElement("div");
            notesHeaderRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-top: 6px;";
            const notesLabel = document.createElement("span");
            notesLabel.textContent = "Notes:";
            notesLabel.style.opacity = "0.7";
            notesHeaderRow.appendChild(notesLabel);
            const notesEditBtn = document.createElement("button");
            notesEditBtn.textContent = "✏ Edit";
            notesEditBtn.style.cssText = "padding: 2px 10px; cursor: pointer; background: #2a2e37; color: #8f8; border: 1px solid #444; border-radius: 4px; font-size: 12px;";
            notesHeaderRow.appendChild(notesEditBtn);
            box.appendChild(notesHeaderRow);

            if (currentData.download_url) {
                const srcLine = document.createElement("div");
                srcLine.style.cssText = "margin-top: 2px;";
                const a = document.createElement("a");
                a.href = currentData.download_url;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.style.cssText = "color: #6cf; word-break: break-all;";
                a.textContent = currentData.download_url;
                srcLine.appendChild(document.createTextNode("Source: "));
                srcLine.appendChild(a);
                box.appendChild(srcLine);
            }

            const notesDisplay = document.createElement("div");
            notesDisplay.textContent = currentData.user_notes || "(no notes yet — click Edit to add some)";
            notesDisplay.style.cssText = `background: #111; border: 1px solid #333; border-radius: 4px; padding: 6px 8px; margin-top: 4px; white-space: pre-wrap; opacity: ${currentData.user_notes ? 1 : 0.6};`;
            box.appendChild(notesDisplay);

            notesEditBtn.onclick = () => {
                const textarea = document.createElement("textarea");
                textarea.value = currentData.user_notes || "";
                textarea.style.cssText = "width: 100%; min-height: 70px; margin-top: 4px; background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 6px; box-sizing: border-box; font-family: inherit;";
                notesDisplay.replaceWith(textarea);
                notesEditBtn.disabled = true;

                const editRow = document.createElement("div");
                editRow.style.cssText = "display: flex; gap: 6px; margin-top: 4px;";
                const saveBtn = document.createElement("button");
                saveBtn.textContent = "Save";
                saveBtn.style.cssText = "padding: 5px 12px; cursor: pointer; background: #2f7a3a; color: #fff; border: 1px solid #3a8f47; border-radius: 4px;";
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "Cancel";
                cancelBtn.style.cssText = "padding: 5px 12px; cursor: pointer; background: #2a2e37; color: #eee; border: 1px solid #444; border-radius: 4px;";
                editRow.appendChild(saveBtn);
                editRow.appendChild(cancelBtn);
                textarea.insertAdjacentElement("afterend", editRow);

                saveBtn.onclick = async () => {
                    saveBtn.textContent = "Saving...";
                    try {
                        const res = await fetch("/lora_stack_pack/notes", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lora_name: loraName, notes: textarea.value }),
                        });
                        const result = await res.json();
                        if (result.ok) {
                            currentData.user_notes = textarea.value;
                        } else {
                            saveBtn.textContent = "Save failed";
                            return;
                        }
                    } catch (e) {
                        saveBtn.textContent = "Save failed";
                        return;
                    }
                    rebuild();
                };
                cancelBtn.onclick = () => rebuild();
            };

            // --- search box: filters & highlights matches in the tag grid
            // and the Trained Words field below, live as you type ---
            const searchWrap = document.createElement("div");
            searchWrap.style.cssText = "margin-top: 8px;";
            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.placeholder = "🔍 Search tags / trained words...";
            searchInput.style.cssText = "width: 100%; box-sizing: border-box; padding: 7px 10px; background: #111; color: #eee; border: 1px solid #444; border-radius: 5px; font-size: 13px;";
            searchWrap.appendChild(searchInput);
            box.appendChild(searchWrap);

            const escapeHtml = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const highlightHtml = (text, term) => {
                const escaped = escapeHtml(text);
                if (!term) return escaped;
                const idx = escaped.toLowerCase().indexOf(term.toLowerCase());
                if (idx === -1) return escaped;
                return (
                    escaped.slice(0, idx) +
                    '<mark style="background:#ffd54f;color:#111;border-radius:2px;padding:0 1px;">' +
                    escaped.slice(idx, idx + term.length) +
                    "</mark>" +
                    escaped.slice(idx + term.length)
                );
            };

            // tag grid, sorted highest -> lowest training-image count (backend already sorts this way)
            const shownCount = (currentData.tags || []).length;
            const totalCount = currentData.total_tags || shownCount;
            const tagsLabel = document.createElement("div");
            tagsLabel.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-top: 6px; gap: 8px;";
            const tagsLabelText = document.createElement("span");
            tagsLabelText.style.opacity = "0.7";
            tagsLabelText.textContent = `Tags (by training-image count, high → low): showing ${shownCount} of ${totalCount}`;
            tagsLabel.appendChild(tagsLabelText);
            if (shownCount < totalCount) {
                const showAllBtn = document.createElement("button");
                showAllBtn.textContent = `Show all (${totalCount})`;
                showAllBtn.style.cssText = "padding: 4px 10px; cursor: pointer; background: #2a2e37; color: #eee; border: 1px solid #444; border-radius: 5px; white-space: nowrap;";
                showAllBtn.onclick = async () => {
                    showAllBtn.textContent = "Loading...";
                    currentData = await fetchLoraInfo(loraName, true);
                    rebuild();
                };
                tagsLabel.appendChild(showAllBtn);
            }
            box.appendChild(tagsLabel);

            const tagGrid = document.createElement("div");
            tagGrid.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; padding: 4px 2px; flex-shrink: 0;";
            const tagChipRefs = [];
            const renderTagChip = (tagObj) => {
                const chip = document.createElement("span");
                chip.style.cssText = `
                    background: #2c5b73; border: 1px solid #3f7691; border-radius: 5px;
                    padding: 3px 8px; cursor: pointer; user-select: none; white-space: nowrap;
                    transition: opacity 0.1s;
                `;
                const countPart = (tagObj.count !== null && tagObj.count !== undefined) ? ` <b>${tagObj.count}</b>` : "";
                chip.innerHTML = `${tagObj.tag}${countPart}`;
                if (selected.has(tagObj.tag)) {
                    chip.style.background = "#4a8a3f";
                }
                chip.onclick = () => {
                    if (selected.has(tagObj.tag)) {
                        selected.delete(tagObj.tag);
                    } else {
                        selected.add(tagObj.tag);
                    }
                    chip.style.background = selected.has(tagObj.tag) ? "#4a8a3f" : "#2c5b73";
                };
                tagChipRefs.push({ tagObj, chip });
                return chip;
            };
            (currentData.tags || []).forEach((t) => tagGrid.appendChild(renderTagChip(t)));
            if (!currentData.tags || currentData.tags.length === 0) {
                const none = document.createElement("div");
                none.textContent = "(no tags found in this file)";
                none.style.opacity = "0.6";
                tagGrid.appendChild(none);
            }
            box.appendChild(tagGrid);

            // separate "Trained Words" field (Civitai's own curated trigger words, if any)
            const twLabel = document.createElement("div");
            twLabel.textContent = "Trained Words:";
            twLabel.style.cssText = "opacity: 0.7; margin-top: 8px;";
            box.appendChild(twLabel);
            const twBox = document.createElement("div");
            const hasTrainedWords = currentData.trained_words && currentData.trained_words.length;
            twBox.textContent = hasTrainedWords
                ? currentData.trained_words.join(", ")
                : "(none found — no .civitai.info sidecar next to this file, or it has no trainedWords)";
            twBox.style.cssText = `background: #111; border: 1px solid #333; border-radius: 4px; padding: 6px 8px; opacity: ${hasTrainedWords ? 1 : 0.6};`;
            box.appendChild(twBox);

            const applySearch = (rawTerm) => {
                const term = rawTerm.trim();
                let firstMatchChip = null;
                tagChipRefs.forEach(({ tagObj, chip }) => {
                    const match = !term || tagObj.tag.toLowerCase().includes(term.toLowerCase());
                    const countPart = (tagObj.count !== null && tagObj.count !== undefined) ? ` <b>${tagObj.count}</b>` : "";
                    chip.innerHTML = highlightHtml(tagObj.tag, term) + countPart;
                    chip.style.opacity = match ? "1" : "0.2";
                    if (match && term && !firstMatchChip) firstMatchChip = chip;
                });
                if (firstMatchChip) {
                    firstMatchChip.scrollIntoView({ block: "nearest" });
                }
                if (hasTrainedWords) {
                    twBox.innerHTML = currentData.trained_words
                        .map((w) => highlightHtml(w, term))
                        .join(", ");
                }
            };
            searchInput.oninput = () => applySearch(searchInput.value);

            // raw metadata (collapsible content area; the toggle itself is a
            // full-width button placed in the button stack below, matching
            // the reference panel's "View raw metadata" row)
            const rawPre = document.createElement("pre");
            rawPre.textContent = JSON.stringify(currentData.raw_metadata || {}, null, 2);
            rawPre.style.cssText = "display: none; white-space: pre-wrap; background: #111; border: 1px solid #333; border-radius: 4px; padding: 8px; max-height: 240px; overflow: auto; margin-top: 4px; flex-shrink: 0;";
            box.appendChild(rawPre);

            // buttons — full-width stacked, matching the civitai-style panel
            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin-top: 8px;";

            const BTN_DEFAULT_BG = "#2a2e37";
            const BTN_SUCCESS_BG = "#2f7a3a";
            const BTN_EMPTY_BG = "#7a5a2a";

            const makeBtn = (label) => {
                const b = document.createElement("button");
                b.textContent = label;
                b.dataset.label = label;
                b.style.cssText = `padding: 10px; cursor: pointer; background: ${BTN_DEFAULT_BG}; color: #eee; border: 1px solid #444; border-radius: 5px; font-size: 13px; transition: background 0.15s;`;
                return b;
            };

            // returns true on success, false if the clipboard API rejected/unavailable
            const copyText = async (text) => {
                try {
                    await navigator.clipboard.writeText(text);
                    return true;
                } catch (e) {
                    return false;
                }
            };

            // briefly swaps a button's text/color to show what just happened,
            // then reverts it back to its normal label after a short delay
            const flashButton = (btn, text, bg, revertDelay = 1800) => {
                clearTimeout(btn._flashTimeout);
                btn.textContent = text;
                btn.style.background = bg;
                btn._flashTimeout = setTimeout(() => {
                    btn.textContent = btn.dataset.label;
                    btn.style.background = BTN_DEFAULT_BG;
                }, revertDelay);
            };

            const copySelectedBtn = makeBtn("Copy Selected");
            copySelectedBtn.onclick = async () => {
                const count = selected.size;
                if (count === 0) {
                    flashButton(copySelectedBtn, "Nothing selected", BTN_EMPTY_BG);
                    return;
                }
                // trailing comma so pasting several copied lists back-to-back
                // never merges the last tag of one into the first of the next
                const ok = await copyText(Array.from(selected).join(", ") + ",");
                flashButton(copySelectedBtn, ok ? `✓ Copied ${count}` : "Copy failed", ok ? BTN_SUCCESS_BG : "#7a2a2a");
            };

            const copyAllBtn = makeBtn("Copy All");
            copyAllBtn.onclick = async () => {
                const tags = currentData.tags || [];
                if (tags.length === 0) {
                    flashButton(copyAllBtn, "No tags", BTN_EMPTY_BG);
                    return;
                }
                const ok = await copyText(tags.map((t) => t.tag).join(", ") + ",");
                flashButton(copyAllBtn, ok ? `✓ Copied ${tags.length}` : "Copy failed", ok ? BTN_SUCCESS_BG : "#7a2a2a");
            };

            const rawMetaBtn = makeBtn("View raw metadata");
            rawMetaBtn.onclick = () => {
                const open = rawPre.style.display !== "none";
                rawPre.style.display = open ? "none" : "block";
                rawMetaBtn.textContent = open ? "View raw metadata" : "Hide raw metadata";
            };

            const closeBtn = makeBtn("Close");
            closeBtn.onclick = close;

            btnRow.appendChild(copySelectedBtn);
            btnRow.appendChild(copyAllBtn);
            btnRow.appendChild(rawMetaBtn);
            btnRow.appendChild(closeBtn);
            box.appendChild(btnRow);
        };

        rebuild();
    });
}

async function openInfoPopupForCombo(comboWidget) {
    const loraName = comboWidget.value;
    if (!loraName || loraName === "None") {
        showLoraInfoDialog("(none selected)", { tags: [], total_tags: 0, trained_words: [], raw_metadata: {}, error: "Select a LoRA first." });
        return;
    }
    const closeLoading = openModal((box) => {
        box.style.cssText += "align-items: center; text-align: center; padding: 30px 40px;";
        const msg = document.createElement("div");
        msg.textContent = "Looking up LoRA info (checking Civitai by file hash on first open — may take a few seconds)...";
        box.appendChild(msg);
    });
    const data = await fetchLoraInfo(loraName, false);
    closeLoading();
    showLoraInfoDialog(loraName, data);
}

// ---------------------------------------------------------------------------
// small helpers for widget layout
// ---------------------------------------------------------------------------
function createSpacerWidget() {
    return {
        name: `__lora_stack_spacer_${Math.random().toString(36).slice(2)}`,
        type: "lora_stack_spacer",
        value: null,
        draw() {},
        computeSize(width) { return [width, 10]; },
        mouse() { return false; },
        serializeValue: undefined,
    };
}

function moveWidgetAfter(node, widget, afterWidget) {
    const from = node.widgets.indexOf(widget);
    if (from === -1) return;
    node.widgets.splice(from, 1);
    const afterIndex = node.widgets.indexOf(afterWidget);
    node.widgets.splice(afterIndex + 1, 0, widget);
}

// ---------------------------------------------------------------------------
// LoRA Stack Container: plain native toggle (unchanged/compact) + a real
// "⚙ info" button right below it, then lora / strength_model / strength_clip,
// then a blank-row spacer before the next slot. The preview image only shows
// inside the ⚙ info popup — not on the node itself.
// ---------------------------------------------------------------------------
function setupContainerNode(node) {
    for (let i = 1; i <= 5; i++) {
        const enabledW = node.widgets.find((w) => w.name === `slot${i}_enabled`);
        const comboW = node.widgets.find((w) => w.name === `slot${i}_lora_name`);
        const scW = node.widgets.find((w) => w.name === `slot${i}_strength_clip`);
        if (!enabledW || !comboW) continue;

        const infoBtn = node.addWidget("button", `⚙ Slot ${i} Info`, null, () => openInfoPopupForCombo(comboW));
        moveWidgetAfter(node, infoBtn, enabledW);

        if (i < 5 && scW) {
            const scIndex = node.widgets.indexOf(scW);
            node.widgets.splice(scIndex + 1, 0, createSpacerWidget());
        }
    }
    node.setDirtyCanvas(true, true);
}

// ---------------------------------------------------------------------------
// Trigger Filter: live preview of its own output, without queueing a prompt.
//
// The real filtering runs in Python, so the editor can't see the result
// until a run. To let downstream frontend-only nodes (e.g. the Tag Toggles
// Reader, which reads a connected node's widget named "text" every frame)
// show up-to-date tags immediately, this watches the LoRA names selected in
// the directly-connected Container node(s) plus our own extra_words, asks
// the backend's /lora_stack_pack/filter route for the same result the node
// would produce, and stores it in a hidden, non-serialized widget "text".
//
// Only DIRECT links Container -> Trigger Filter are understood; anything
// in between (other nodes) is invisible to this and simply yields no tags.
// ---------------------------------------------------------------------------
function getLinkById(linkId) {
    const links = app.graph && app.graph.links;
    if (!links || linkId === null || linkId === undefined) return null;
    return typeof links.get === "function" ? links.get(linkId) : links[linkId];
}

// LoRA name feeding trigger_words_<index>, or "" if unconnected / not a Container
function loraNameForFilterInput(node, index) {
    const slot = node.inputs ? node.inputs.findIndex((inp) => inp.name === `trigger_words_${index}`) : -1;
    if (slot < 0) return "";
    const link = getLinkById(node.inputs[slot].link);
    if (!link) return "";
    const origin = app.graph.getNodeById(link.origin_id);
    if (!origin || origin.comfyClass !== "LoraStackContainer5") return "";
    const outSlot = link.origin_slot; // 0 = lora_stack, 1..5 = trigger_words_1..5
    if (outSlot < 1 || outSlot > 5) return "";
    const w = origin.widgets ? origin.widgets.find((x) => x.name === `slot${outSlot}_lora_name`) : null;
    const v = w && typeof w.value === "string" ? w.value : "";
    return v === "None" ? "" : v;
}

// Best-effort read of the string wired into `inputName` of `node`. Works for
// anything that keeps its text in a frontend widget (Text Multiline, a
// Primitive, another Trigger Filter's live "text", ...) and follows Reroute
// style pass-through nodes. Text produced only by Python at run time can't be
// seen from here — that case yields null (the real run still works).
const UPSTREAM_TEXT_WIDGET_NAMES = ["text", "string", "value", "prompt", "tags"];

function isInputLinked(node, inputName) {
    const inp = node.inputs ? node.inputs.find((i) => i.name === inputName) : null;
    return !!(inp && inp.link !== null && inp.link !== undefined && getLinkById(inp.link));
}

function readWidgetString(originNode) {
    const ws = originNode.widgets || [];
    for (const name of UPSTREAM_TEXT_WIDGET_NAMES) {
        const w = ws.find((x) => x.name === name && typeof x.value === "string");
        if (w) return w.value;
    }
    const first = ws.find((x) => typeof x.value === "string");
    return first ? first.value : null;
}

function readUpstreamString(node, inputName, depth = 0) {
    if (depth > 8 || !node.inputs) return null;
    const inp = node.inputs.find((i) => i.name === inputName);
    const link = inp ? getLinkById(inp.link) : null;
    if (!link) return null;
    const origin = app.graph.getNodeById(link.origin_id);
    if (!origin) return null;
    const direct = readWidgetString(origin);
    if (direct !== null) return direct;
    // no text widget: maybe a pass-through node — follow its first input
    if (origin.inputs && origin.inputs.length > 0) {
        return readUpstreamString(origin, origin.inputs[0].name, depth + 1);
    }
    return null;
}

function setupTriggerFilterNode(node) {
    // Hidden, zero-height widget. The name "text" is deliberate: the Tag
    // Toggles Reader looks for a widget called "text" first.
    const liveWidget = {
        name: "text",
        type: "lora_stack_live_text",
        value: "",
        serialize: false,
        options: { serialize: false },
        draw() {},
        computeSize() { return [0, -4]; },
        mouse() { return false; },
    };
    node.widgets.push(liveWidget);

    let alive = true;
    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        alive = false;
        return origOnRemoved ? origOnRemoved.apply(this, arguments) : undefined;
    };

    let lastKey = null;
    let debounceTimer = null;
    let requestSeq = 0;

    function readState() {
        // when a wire is plugged into the extra_words pin, its own widget
        // value is stale — the real text comes from the connected node
        let extra = "";
        if (isInputLinked(node, "extra_words")) {
            const up = readUpstreamString(node, "extra_words");
            extra = typeof up === "string" ? up : "";
        } else {
            const extraW = node.widgets ? node.widgets.find((w) => w.name === "extra_words") : null;
            extra = extraW && typeof extraW.value === "string" ? extraW.value : "";
        }
        const names = [1, 2, 3, 4, 5].map((i) => loraNameForFilterInput(node, i));
        return { extra, names, key: JSON.stringify([extra, names]) };
    }

    async function refresh(state) {
        const seq = ++requestSeq;
        try {
            const res = await fetch("/lora_stack_pack/filter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ extra_words: state.extra, lora_names: state.names }),
            });
            const data = await res.json();
            if (!alive || seq !== requestSeq) return; // a newer request superseded this one
            liveWidget.value = typeof data.filtered === "string" ? data.filtered : "";
            node.setDirtyCanvas(true, true);
        } catch (e) {
            /* keep the previous value if the request fails */
        }
    }

    function tick() {
        if (!alive) return;
        const state = readState();
        if (state.key !== lastKey) {
            lastKey = state.key;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => refresh(state), 250);
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

app.registerExtension({
    name: "LoraStackPack.UI",
    async nodeCreated(node) {
        if (node.comfyClass === "LoraStackContainer5") {
            setupContainerNode(node);
        } else if (node.comfyClass === "LoraTriggerFilter") {
            setupTriggerFilterNode(node);
        }
    },
});
