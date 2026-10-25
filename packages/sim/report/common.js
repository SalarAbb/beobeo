const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/_([^_]+)_/g, "<em>$1</em>");
const fmtDate = (iso, o = { month: "short", day: "numeric" }) => new Date(iso + (iso.length === 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-US", o);
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)} s` : `${Math.round(x)} ms`);
const byId = Object.fromEntries((D.personas ?? []).map((p) => [p.id, p]));
const first = (id) => (byId[id]?.name ?? id).split(" ")[0];
const initials = (id) => (byId[id]?.name ?? id).split(" ").map((w) => w[0]).join("").slice(0, 2);

/* ---------- tooltip */
const tip = $("tip");
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - r.width - 12, x + 14) + "px";
  tip.style.top = (y + r.height + 24 > window.innerHeight ? y - r.height - 14 : y + 16) + "px";
}
const hideTip = () => (tip.hidden = true);
function hover(el, html) {
  el.addEventListener("mousemove", (e) => showTip(html(), e.clientX, e.clientY));
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); showTip(html(), r.left + 20, r.bottom - 8); });
  el.addEventListener("blur", hideTip);
}

/* ---------- speed (log scale 100 ms – 60 s) */
const LO = Math.log10(80), HI = Math.log10(60000);
const x = (v) => ((Math.log10(Math.max(80, Math.min(60000, v))) - LO) / (HI - LO)) * 100;
const TICKS = [100, 300, 1000, 3000, 10000, 30000];
const targetLabel = (t) => t.replace(/^trpc:/, "").replace(/^page:/, "page ").replace(/^auth:/, "").replace(/^chat:first-token$/, "chat · first word");
function renderSpeed(latency, ticksEl, speedEl, windowNote) {
  ticksEl.innerHTML = TICKS.map((t) => `<span style="left:${x(t)}%">${ms(t)}</span>`).join("");
  speedEl.innerHTML = latency.map((l, i) => {
    const over = l.budget !== null && l.p95 > l.budget;
    return `<div class="srow" tabindex="0" data-l="${i}">
      <span class="lab">${esc(targetLabel(l.target))}</span>
      <div class="track">${TICKS.map((t) => `<i class="grid" style="left:${x(t)}%"></i>`).join("")}
        <i class="span" style="left:${x(l.p50)}%;width:${Math.max(0, x(l.p95) - x(l.p50))}%"></i>
        ${l.budget !== null ? `<i class="budget" style="left:${x(l.budget)}%"></i>` : ""}
        <i class="p p50" style="left:${x(l.p50)}%"></i><i class="p p95 ${over ? "over" : "ok"}" style="left:${x(l.p95)}%"></i></div>
      <span class="val">${ms(l.p50)} · ${ms(l.p95)} ${l.budget === null ? "" : over ? `<span class="pill bad">over</span>` : `<span class="pill good">ok</span>`}</span></div>`;
  }).join("") || `<p class="muted">No timings yet.</p>`;
  speedEl.querySelectorAll(".srow").forEach((row) => {
    const l = latency[+row.dataset.l];
    hover(row, () => `<b class="mono">${esc(l.target)}</b>
      <div class="row"><span>typical (p50)</span><span class="mono">${ms(l.p50)}</span></div>
      <div class="row"><span>slow tail (p95)</span><span class="mono">${ms(l.p95)}</span></div>
      <div class="row"><span>budget</span><span class="mono">${l.budget === null ? "none set" : ms(l.budget)}</span></div>
      <div class="w">${l.n} measurements ${windowNote}</div>`);
  });
}

/* ---------- answers: one column per rating, persona initials stacked */
function renderStrip(answers, stripEl) {
  const byRating = [1, 2, 3, 4, 5].map((r) => answers.filter((a) => a.rating === r));
  stripEl.innerHTML = byRating.map((list, i) => `<div class="col"><div class="stack">${list.map((a) => `<span class="ini" tabindex="0" data-a="${answers.indexOf(a)}">${esc(initials(a.persona))}</span>`).join("")}</div><span class="r">${i + 1}</span></div>`).join("");
  stripEl.querySelectorAll(".ini").forEach((el) => {
    const a = answers[+el.dataset.a];
    hover(el, () => `<b>${esc(byId[a.persona]?.name ?? a.persona)} · ${a.rating}/5</b><div class="w">Asked</div><div>${esc(a.question)}</div><div class="w">Said</div><div class="q">${esc(a.note)}</div>${a.firstTokenMs ? `<div class="w">First word after ${ms(a.firstTokenMs)}</div>` : ""}`);
  });
}
function worstQuote(a) {
  return a ? `<p>“${esc(a.note.split(/(?<=[.!?])\s/).slice(0, 3).join(" "))}”</p><cite>${esc(byId[a.persona]?.name ?? a.persona)}, rating ${a.rating}/5, on “${esc(a.question.length > 110 ? a.question.slice(0, 108) + "…" : a.question)}”</cite>` : "";
}

/* ---------- minimal markdown for evolve reports: headings, bullets, fences, paragraphs */
function mdBlock(src) {
  const out = []; let list = null, fence = null;
  const flush = () => { if (list) { out.push(`<ul>${list.map((l) => `<li>${md(l)}</li>`).join("")}</ul>`); list = null; } };
  for (const line of src.split("\n")) {
    if (fence !== null) { if (line.startsWith("```")) { out.push(`<pre>${esc(fence)}</pre>`); fence = null; } else fence += line + "\n"; continue; }
    if (line.startsWith("```")) { flush(); fence = ""; continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) { flush(); const n = Math.max(2, h[1].length); out.push(`<h${n}>${md(h[2])}</h${n}>`); continue; }
    const b = /^\s*[-*]\s+(.*)/.exec(line);
    if (b) { (list ??= []).push(b[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    flush(); out.push(`<p>${md(line)}</p>`);
  }
  flush();
  return out.join("");
}

/* ---------- experience scores: ordinal blue ramp, number always printed (never color alone) */
const heatBg = (n) => `var(--h${Math.max(1, Math.min(5, Math.round(n)))})`;
const heatInk = (n) => (Math.round(n) >= 3 ? "var(--h-ink-dark)" : "var(--h-ink-light)");
const scorePill = (label, n) => (n == null ? "" : `<span class="pill ${n >= 4 ? "good" : n >= 3 ? "warn" : "bad"}">${label} ${n}/5</span>`);
const DIM_LABELS = { ease: "Ease", speed: "Speed", trust: "Trust", usefulness: "Usefulness", look: "Look" };
function renderDims(el, row) {
  el.innerHTML = Object.entries(DIM_LABELS).map(([k, label]) => {
    const v = row?.[k];
    return `<div class="dim"><span>${label}</span><span class="lane" aria-hidden="true">${v == null ? "" : `<i style="width:${((v - 1) / 4) * 100}%"></i>`}<s style="left:50%"></s></span><span class="v">${v == null ? "—" : v.toFixed(1)}</span></div>`;
  }).join("");
}
