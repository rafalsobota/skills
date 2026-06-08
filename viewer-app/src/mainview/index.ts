// viewer-app/src/mainview/index.ts
import Electrobun, { Electroview } from "electrobun/view";
import type { SednoRPC } from "../bun/index";
import type { VersionMeta, Comment, CommentTarget } from "../../../src/types";

const stage = document.getElementById("stage")!;
const timelineEl = document.getElementById("timeline")!;
const statusEl = document.getElementById("status")!;
const curLabel = document.getElementById("curLabel")!;
const queueEl = document.getElementById("queue")!;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const globalBtn = document.getElementById("globalBtn")!;
const popover = document.getElementById("popover")!;
const popTarget = document.getElementById("popTarget")!;
const popText = document.getElementById("popText") as HTMLTextAreaElement;

let currentVersionId: string | null = null;
let queue: Comment[] = [];
let activeTarget: CommentTarget | null = null;

function setStatus(t: string, ok: boolean) { statusEl.textContent = t; statusEl.className = "status" + (ok ? " ok" : ""); }
function clearChildren(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }
function emptyMsg(text: string) { const d = document.createElement("div"); d.className = "empty"; d.textContent = text; return d; }

function setCurrent(version: VersionMeta) {
  currentVersionId = version.id;
  curLabel.textContent = version.id + (version.title ? " · " + version.title : "");
}

// Safe SVG insertion: parse as XML and import the node (no HTML property side effects).
function swapSvg(svg: string) {
  clearChildren(stage);
  if (!svg) { stage.appendChild(emptyMsg("Pusty diagram.")); markCommented(); return; }
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === "parsererror") { stage.appendChild(emptyMsg("Błąd parsowania SVG.")); return; }
  stage.appendChild(document.importNode(root, true));
  markCommented();
}

function renderTimeline(history: VersionMeta[], currentId: string) {
  clearChildren(timelineEl);
  (history || []).forEach((v) => {
    const li = document.createElement("li");
    li.dataset.id = v.id;
    if (v.id === currentId) li.className = "current";
    const label = document.createElement("span");
    label.textContent = v.id + (v.title ? " · " + v.title : "");
    li.appendChild(label);
    if (v.basedOn) { const b = document.createElement("span"); b.className = "based"; b.textContent = "← " + v.basedOn; li.appendChild(b); }
    timelineEl.appendChild(li);
  });
}
function markCurrentInTimeline(id: string) {
  Array.prototype.forEach.call(timelineEl.children, (li: HTMLElement) => { li.className = li.dataset.id === id ? "current" : ""; });
}

function openPopover(target: CommentTarget, x: number, y: number) {
  activeTarget = target;
  popTarget.textContent = target.kind === "global" ? "Komentarz ogólny" : "Element: " + (target as { id: string }).id;
  popText.value = "";
  popover.style.left = Math.min(x, window.innerWidth - 300) + "px";
  popover.style.top = Math.min(y, window.innerHeight - 220) + "px";
  popover.classList.add("open");
  popText.focus();
}
function closePopover() { popover.classList.remove("open"); activeTarget = null; }

function updateQueue() {
  queueEl.textContent = queue.length + (queue.length === 1 ? " komentarz" : " komentarzy") + " w kolejce";
  sendBtn.disabled = queue.length === 0;
}
function markCommented() {
  const ids: Record<string, boolean> = {};
  queue.forEach((cm) => { if (cm.versionId === currentVersionId && cm.target.kind === "element") ids[cm.target.id] = true; });
  Array.prototype.forEach.call(stage.querySelectorAll("[data-node-id],[data-edge-id]"), (el: Element) => {
    const id = el.getAttribute("data-node-id") || el.getAttribute("data-edge-id") || "";
    if (ids[id]) el.setAttribute("data-commented", "1"); else el.removeAttribute("data-commented");
  });
}

// --- transport: Electroview RPC (bun main relays to/from the server socket) ---
const rpc = Electroview.defineRPC<SednoRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      render: ({ version, svg, history }) => {
        setStatus("połączono", true); swapSvg(svg); setCurrent(version); renderTimeline(history, version.id);
      },
      show: ({ version, svg }) => {
        swapSvg(svg); setCurrent(version); markCurrentInTimeline(version.id);
      },
      reload: () => location.reload(),
    },
  },
});
const electroview = new Electrobun.Electroview({ rpc });

// --- UI events -> RPC -> bun main -> server socket ---
timelineEl.addEventListener("click", (ev) => {
  const li = (ev.target as Element).closest("li") as HTMLElement | null;
  if (li && li.dataset.id) electroview.rpc!.send.requestShow({ id: li.dataset.id });
});
stage.addEventListener("click", (ev) => {
  const el = (ev.target as Element).closest("[data-node-id],[data-edge-id]");
  if (!el) return;
  const id = el.getAttribute("data-node-id") || el.getAttribute("data-edge-id") || "";
  openPopover({ kind: "element", id }, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
});
globalBtn.addEventListener("click", () => openPopover({ kind: "global" }, window.innerWidth - 320, 120));
Array.prototype.forEach.call(popover.querySelectorAll(".chips button"), (b: HTMLElement) => {
  b.addEventListener("click", () => { popText.value = ((b.dataset.emoji || "") + " " + popText.value).replace(/^\s+/, ""); popText.focus(); });
});
document.getElementById("popCancel")!.addEventListener("click", closePopover);
document.getElementById("popAdd")!.addEventListener("click", () => {
  const text = popText.value.trim();
  if (!text || !activeTarget) { closePopover(); return; }
  queue.push({ versionId: currentVersionId, target: activeTarget, text });
  updateQueue(); closePopover(); markCommented();
});
sendBtn.addEventListener("click", () => {
  if (queue.length === 0) return;
  electroview.rpc!.send.flush({ comments: queue.slice() });
  queue = []; updateQueue(); markCommented();
});

// Tell the bun main we are mounted so it asks the server to (re)send current state.
electroview.rpc!.send.ready({});
