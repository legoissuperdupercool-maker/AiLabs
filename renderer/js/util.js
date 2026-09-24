// Small DOM + formatting helpers shared by the UI.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // Minimal, safe markdown: code blocks, inline code, bold, italics, links, headings, lists.
  function md(src) {
    const blocks = [];
    let text = String(src ?? '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      blocks.push(`<pre class="code"><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    text = esc(text)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank">$2</a>');
    const lines = text.split('\n');
    const out = [];
    let list = null;
    for (const line of lines) {
      const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      const hd = line.match(/^(#{1,4})\s+(.*)$/);
      if (li) { if (!list) { list = []; } list.push(`<li>${li[1]}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
      if (hd) out.push(`<div class="md-h">${hd[2]}</div>`);
      else out.push(line ? `<p>${line}</p>` : '');
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]).replace(/<p>(<pre[\s\S]*?<\/pre>)<\/p>/g, '$1');
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0));

  // Tiny synthesized sound effects (no audio files needed).
  let audio = null;
  function beep(kind) {
    try {
      audio = audio || new AudioContext();
      const notes = { done: [660, 880], alert: [520, 390, 520], hire: [440, 550, 660] }[kind] || [600];
      notes.forEach((f, i) => {
        const o = audio.createOscillator(); const g = audio.createGain();
        o.type = 'square'; o.frequency.value = f;
        const t0 = audio.currentTime + i * 0.09;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
        o.connect(g).connect(audio.destination);
        o.start(t0); o.stop(t0 + 0.09);
      });
    } catch {}
  }

  window.U = { esc, h, $, $$, md, timeAgo, fmtTokens, beep };
})();
