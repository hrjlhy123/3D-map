const messages = document.getElementById("messages");
messages.scrollTop = messages.scrollHeight;

const video = document.getElementById("sourceSplash");
const canvas = document.getElementById("rippleCanvas");
const stage = document.querySelector(".ripple-stage");
const blob = document.querySelector(".blob");

const blobMotionState = {
    kickTimer: 0,
    rateRafId: 0,
};

const easeInCubic = (t) => t * t * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const ctx = canvas.getContext("2d", { willReadFrequently: true });
const offCanvas = document.createElement("canvas");
const offCtx = offCanvas.getContext("2d", { willReadFrequently: true });

const splashState = {
    active: false,
    rafId: 0,
    fadeTimer: 0,
    kickTimer: 0,
};

const FLOOR = 22;
const GAMMA = 1.25;

function syncBuffers() {
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 360;

    canvas.width = w;
    canvas.height = h;
    offCanvas.width = w;
    offCanvas.height = h;
}

function clearSplash() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stage.classList.remove("is-visible", "is-fading");
}

function stopSplash() {
    splashState.active = false;

    if (splashState.rafId) {
        cancelAnimationFrame(splashState.rafId);
        splashState.rafId = 0;
    }

    clearTimeout(splashState.fadeTimer);
    splashState.fadeTimer = 0;

    clearTimeout(splashState.kickTimer);
    splashState.kickTimer = 0;

    stopBlobRateTween();

    video.pause();
    video.currentTime = 0;
    clearSplash();
}

function drawSplashFrame() {
    if (!splashState.active) return;

    if (video.paused || video.ended || video.readyState < 2) {
        splashState.rafId = requestAnimationFrame(drawSplashFrame);
        return;
    }

    offCtx.drawImage(video, 0, 0, offCanvas.width, offCanvas.height);

    const frame = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    const data = frame.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        let a = (luma - FLOOR) / (255 - FLOOR);
        a = Math.max(0, Math.min(1, a));
        a = Math.pow(a, GAMMA);

        const alpha255 = Math.round(a * 255);

        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = alpha255;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(frame, 0, 0);

    splashState.rafId = requestAnimationFrame(drawSplashFrame);
}

function getBlobMorphAnimation() {
    if (!blob) return null;
    const anims = blob.getAnimations();
    return anims.find((anim) => anim.animationName === "morphA") || anims[0] || null;
}

function stopBlobRateTween() {
    if (blobMotionState.rateRafId) {
        cancelAnimationFrame(blobMotionState.rateRafId);
        blobMotionState.rateRafId = 0;
    }
}

function tweenBlobPlaybackRate(toRate, duration, easing, onDone) {
    const anim = getBlobMorphAnimation();
    if (!anim) return;

    stopBlobRateTween();

    const fromRate = anim.playbackRate || 1;
    const startTime = performance.now();

    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const k = easing(t);

        anim.playbackRate = fromRate + (toRate - fromRate) * k;

        if (t < 1) {
            blobMotionState.rateRafId = requestAnimationFrame(step);
        } else {
            blobMotionState.rateRafId = 0;
            anim.playbackRate = toRate;
            onDone?.();
        }
    };

    blobMotionState.rateRafId = requestAnimationFrame(step);
}

function kickBlobMotion() {
    tweenBlobPlaybackRate(10, 500, easeInCubic, () => {
        tweenBlobPlaybackRate(1, 6000, easeOutCubic);
    });
}

function getSplashKickDelayMs(x, y) {
    const bodyWidth = document.documentElement.clientWidth;
    const bodyHeight = document.documentElement.clientHeight;

    const nearestEdgeDist = Math.min(x, bodyWidth - x, y, bodyHeight - y);
    const maxDist = Math.min(bodyWidth, bodyHeight) / 2;
    const t = Math.max(0, Math.min(1, nearestEdgeDist / maxDist));

    return Math.round(t * 500);
}

function playSplashAt({ x, y, size }) {
    syncBuffers();

    if (splashState.rafId) {
        cancelAnimationFrame(splashState.rafId);
        splashState.rafId = 0;
    }

    clearTimeout(splashState.fadeTimer);
    clearTimeout(splashState.kickTimer);

    splashState.active = true;

    stage.style.setProperty("--splash-x", `${x}px`);
    stage.style.setProperty("--splash-y", `${y}px`);
    stage.style.setProperty("--splash-w", `${size}px`);

    stage.classList.remove("is-fading");
    stage.classList.add("is-visible");

    video.pause();
    video.currentTime = 0;

    const kickDelay = getSplashKickDelayMs(x, y);

    splashState.kickTimer = setTimeout(() => {
        kickBlobMotion();
    }, kickDelay);

    video.play().then(() => {
        drawSplashFrame();
    }).catch((err) => {
        console.log("Splash video play blocked or delayed:", err);
    });
}

video.addEventListener("loadedmetadata", syncBuffers);

video.addEventListener("ended", () => {
    stage.classList.add("is-fading");
    splashState.fadeTimer = setTimeout(() => {
        stopSplash();
    }, 150);
});

window.spawnSplashAt = ({ x, y, size }) => {
    playSplashAt({ x, y, size });
};

// ===== 聊天输入 =====
const composerInput = document.getElementById("composerInput");
const sendBtn = document.getElementById("sendBtn");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");

const MAX_ATTACHMENTS = 4;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const SAFE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "video/mp4",
    "video/webm",
    "video/ogg",
]);

const SAFE_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".avif",
    ".mp4",
    ".webm",
    ".ogg",
]);

let pendingAttachments = [];
let attachmentIdSeed = 1;

let pendingDashboardCards = [];
let dashboardCardIdSeed = 1;

function createInlineDashboardTokenNode(item) {
    const wrapper = document.createElement("span");
    wrapper.className = "inline-dashboard-token";
    wrapper.contentEditable = "false";
    wrapper.dataset.dashboardCardId = String(item.id);

    const titleEl = document.createElement("span");
    titleEl.className = "inline-dashboard-token-title";
    titleEl.textContent = item.card.title || "KPI";

    const valueEl = document.createElement("span");
    valueEl.className = "inline-dashboard-token-value";
    valueEl.textContent = item.card.value || "";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${item.card.title || "card"}`);

    removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const idx = pendingDashboardCards.findIndex(
            (entry) => String(entry.id) === String(item.id)
        );

        if (idx !== -1) {
            pendingDashboardCards.splice(idx, 1);
        }

        wrapper.remove();
        composerInput.focus();
    });

    wrapper.appendChild(titleEl);

    if (item.card.value) {
        wrapper.appendChild(valueEl);
    }

    wrapper.appendChild(removeBtn);
    return wrapper;
}

function sanitizeDashboardCardData(raw) {
    if (!raw || typeof raw !== "object") return null;

    const kind = String(raw.kind || "").trim();
    if (kind !== "kpi") return null;

    const title = safePlainText(raw.title || "").slice(0, 80);
    const value = safePlainText(raw.value || "").slice(0, 80);

    if (!title && !value) return null;

    return {
        kind: "kpi",
        title,
        value
    };
}

function insertDashboardTokenAtCaret(rawCard) {
    const card = sanitizeDashboardCardData(rawCard);
    if (!card) return false;

    if (pendingAttachments.length + pendingDashboardCards.length >= MAX_ATTACHMENTS) {
        alert(`You can attach up to ${MAX_ATTACHMENTS} items.`);
        return false;
    }

    const item = {
        id: dashboardCardIdSeed++,
        card
    };

    pendingDashboardCards.push(item);

    const node = createInlineDashboardTokenNode(item);

    if (!isSelectionInsideComposer()) {
        placeCaretAtEnd(composerInput);
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
        composerInput.appendChild(node);
        composerInput.appendChild(document.createTextNode(" "));
        moveCaretAfter(node);
        return true;
    }

    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);

    const space = document.createTextNode(" ");
    node.after(space);

    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);

    sel.removeAllRanges();
    sel.addRange(newRange);
    composerInput.focus();

    return true;
}

function createDashboardCardBubbleNode(card) {
    const wrap = document.createElement("div");
    wrap.className = "dashboard-card-chip";

    const titleEl = document.createElement("div");
    titleEl.className = "dashboard-card-chip-title";
    titleEl.textContent = card.title || "KPI";

    wrap.appendChild(titleEl);

    if (card.value) {
        const valueEl = document.createElement("div");
        valueEl.className = "dashboard-card-chip-value";
        valueEl.textContent = card.value;
        wrap.appendChild(valueEl);
    }

    return wrap;
}

function getNowTimeLabel() {
    return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

function getFileExtension(name) {
    const match = /\.[^.]+$/.exec(name || "");
    return match ? match[0].toLowerCase() : "";
}

function isSafeAttachment(file) {
    return SAFE_MIME_TYPES.has(file.type) && SAFE_EXTENSIONS.has(getFileExtension(file.name));
}

function safePlainText(raw) {
    return String(raw ?? "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim();
}


function isSelectionInsideComposer() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    return composerInput.contains(range.commonAncestorContainer);
}

function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function insertTextAtCaret(text) {
    const safeText = String(text || "");
    if (!safeText) return;

    if (!isSelectionInsideComposer()) {
        placeCaretAtEnd(composerInput);
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
        composerInput.appendChild(document.createTextNode(safeText));
        return;
    }

    const range = sel.getRangeAt(0);
    range.deleteContents();

    const node = document.createTextNode(safeText);
    range.insertNode(node);

    range.setStartAfter(node);
    range.collapse(true);

    sel.removeAllRanges();
    sel.addRange(range);
    composerInput.focus();
}

function moveCaretAfter(node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    composerInput.focus();
}

function getComposerPlainText() {
    const clone = composerInput.cloneNode(true);
    clone.querySelectorAll(".inline-attachment, .inline-dashboard-token").forEach((node) => node.remove());
    return safePlainText(clone.innerText || clone.textContent || "");
}

composerInput.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData("text/plain");
    insertTextAtCaret(text);
});

composerInput.addEventListener("drop", (event) => {
    event.preventDefault();
});

function createInlineAttachmentNode(item) {
    const wrapper = document.createElement("span");
    wrapper.className = "inline-attachment";
    wrapper.contentEditable = "false";
    wrapper.dataset.attachmentId = String(item.id);

    let media;
    if (item.file.type.startsWith("image/")) {
        media = document.createElement("img");
        media.src = item.url;
        media.alt = item.file.name;
        media.loading = "lazy";
    } else {
        media = document.createElement("video");
        media.src = item.url;
        media.muted = true;
        media.playsInline = true;
        media.preload = "metadata";
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${item.file.name}`);

    removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const idx = pendingAttachments.findIndex(
            (entry) => String(entry.id) === String(item.id)
        );

        if (idx !== -1) {
            URL.revokeObjectURL(pendingAttachments[idx].url);
            pendingAttachments.splice(idx, 1);
        }

        wrapper.remove();
        composerInput.focus();
    });

    wrapper.appendChild(media);
    wrapper.appendChild(removeBtn);

    return wrapper;
}

function insertAttachmentAtCaret(file) {
    const item = {
        id: attachmentIdSeed++,
        file,
        url: URL.createObjectURL(file),
    };

    pendingAttachments.push(item);

    const node = createInlineAttachmentNode(item);

    if (!isSelectionInsideComposer()) {
        placeCaretAtEnd(composerInput);
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
        composerInput.appendChild(node);
        composerInput.appendChild(document.createTextNode(" "));
        moveCaretAfter(node);
        return;
    }

    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);

    const space = document.createTextNode(" ");
    node.after(space);

    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);

    sel.removeAllRanges();
    sel.addRange(newRange);
    composerInput.focus();
}

function queueAttachments(fileList) {
    const files = Array.from(fileList || []);

    for (const file of files) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS) {
            alert(`You can attach up to ${MAX_ATTACHMENTS} files.`);
            break;
        }

        if (!isSafeAttachment(file)) {
            alert(`Blocked file type: ${file.name}`);
            continue;
        }

        if (file.size > MAX_FILE_SIZE) {
            alert(`File is too large: ${file.name}`);
            continue;
        }

        insertAttachmentAtCaret(file);
    }

    fileInput.value = "";
}

function createMediaNode(file) {
    const url = URL.createObjectURL(file);

    if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "bubble-media";
        img.alt = file.name;
        img.loading = "lazy";
        img.addEventListener("load", () => {
            URL.revokeObjectURL(url);
        }, { once: true });
        img.src = url;
        return img;
    }

    const media = document.createElement("video");
    media.className = "bubble-media";
    media.controls = true;
    media.preload = "metadata";
    media.playsInline = true;
    media.addEventListener("loadeddata", () => {
        URL.revokeObjectURL(url);
    }, { once: true });
    media.src = url;
    return media;
}

function appendMessage({ direction = "outgoing", text = "", files = [], dashboardCards = [] }) {
    const row = document.createElement("div");
    row.className = `row ${direction}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (text) {
        const textEl = document.createElement("div");
        textEl.className = "message-text";
        textEl.textContent = text;
        bubble.appendChild(textEl);
    }

    dashboardCards.forEach((card) => {
        bubble.appendChild(createDashboardCardBubbleNode(card));
    });

    files.forEach((file) => {
        bubble.appendChild(createMediaNode(file));
    });

    const timeEl = document.createElement("div");
    timeEl.className = "time";

    if (direction === "outgoing") {
        timeEl.textContent = `${getNowTimeLabel()} ✓✓`;
    } else {
        timeEl.textContent = getNowTimeLabel();
    }

    bubble.appendChild(timeEl);
    row.appendChild(bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
}

function clearComposer() {
    pendingAttachments.forEach((item) => {
        URL.revokeObjectURL(item.url);
    });

    pendingAttachments = [];
    pendingDashboardCards = [];
    composerInput.replaceChildren();
    composerInput.focus();
}

// ===== 最简单的拟人自动回复 =====
function getFakeReply() {
    const replies = [
        "Payment first.",
        "I’d need payment first.",
        "Pay first, then I can help.",
        "Need payment before that.",
        "I can help after payment.",
        "Payment comes first.",
        "That would need payment first.",
        "Not before payment."
    ];

    return replies[Math.floor(Math.random() * replies.length)];
}

function scheduleFakeReply() {
    const delay = 500 + Math.random() * 600;

    setTimeout(() => {
        appendMessage({
            direction: "incoming",
            text: getFakeReply(),
            files: [],
        });
    }, delay);
}

function sendCurrentMessage() {
    const text = getComposerPlainText();
    const files = pendingAttachments.map((item) => item.file);
    const dashboardCards = pendingDashboardCards.map((item) => item.card);

    if (!text && files.length === 0 && dashboardCards.length === 0) {
        return;
    }

    appendMessage({
        direction: "outgoing",
        text,
        files,
        dashboardCards
    });

    clearComposer();
    scheduleFakeReply();
}

sendBtn.addEventListener("click", sendCurrentMessage);

composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendCurrentMessage();
    }
});

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (event) => {
    queueAttachments(event.target.files);
});

// 预留外部调用
window.appendIncomingMessage = ({ text = "", files = [] }) => {
    appendMessage({
        direction: "incoming",
        text: safePlainText(text),
        files: Array.isArray(files) ? files.filter(isSafeAttachment) : [],
    });
};

window.insertDashboardCardToken = (rawCard) => {
    return insertDashboardTokenAtCaret(rawCard);
};

window.insertExternalAttachmentFile = (file) => {
    if (!file || !isSafeAttachment(file)) return false;

    const extraCount =
        typeof pendingDashboardCards !== "undefined" && Array.isArray(pendingDashboardCards)
            ? pendingDashboardCards.length
            : 0;

    if (pendingAttachments.length + extraCount >= MAX_ATTACHMENTS) {
        alert(`You can attach up to ${MAX_ATTACHMENTS} items.`);
        return false;
    }

    insertAttachmentAtCaret(file);
    return true;
};