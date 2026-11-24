// mermaid.harsath.com: mermaid editor with live preview, export and expiring share links.
// Rendering and export happen in the browser. Supabase only stores shared diagrams,
// encrypted (crypto.js); see supabase/migrations/ for the server side.

import * as C from './crypto.js'

const SUPABASE_URL = 'https://vakzpjtoqvzxmilqnbwr.supabase.co'
const SUPABASE_KEY = 'sb_publishable_gQ7JlF6hbkTQjoRsAIL8rQ_32rs1xdC' // publishable: safe in the client
const LIBS = {
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm',
  svg2pdf: 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.9.0/+esm',
}
const DRAFT_KEY = 'mermaid-draft'
const SAMPLE = `flowchart LR
    A[Write mermaid] --> B{Looks right?}
    B -- yes --> C[Export SVG / PNG / PDF]
    B -- no --> A
    C --> D[Share a link]
`

const $ = sel => document.querySelector(sel)
const editor = $('#code')

// localStorage can throw (private mode, blocked storage); the app works without it.
const draft = {
  get() { try { return localStorage.getItem(DRAFT_KEY) } catch { return null } },
  set(v) { try { localStorage.setItem(DRAFT_KEY, v) } catch {} },
}

function showMsg(text) {
  $('#msg').textContent = text
  $('#msg').hidden = !text
}

// --- rendering ---

const { default: mermaid } = await import(LIBS.mermaid)
const BASE = { startOnLoad: false, securityLevel: 'strict' }
// Exports use plain SVG text instead of HTML labels (<foreignObject>), which
// canvases and svg2pdf can't draw.
const EXPORT = { ...BASE, htmlLabels: false, flowchart: { htmlLabels: false } }

// mermaid keeps global config, so renders run one at a time.
let seq = 0
let queue = Promise.resolve()
function renderSvg(code, config) {
  const job = queue.then(async () => {
    mermaid.initialize(config)
    await mermaid.parse(code)
    return (await mermaid.render(`m${++seq}`, code)).svg
  })
  queue = job.catch(() => {})
  return job
}

let latest = 0
async function preview() {
  const mine = ++latest
  const code = editor.value
  try {
    const svg = await renderSvg(code, BASE)
    if (mine !== latest) return
    $('#preview').innerHTML = svg
    applyZoom()
    $('#error').hidden = true
  } catch (e) {
    if (mine !== latest) return
    $('#error').textContent = e.message || String(e) // keep the last good diagram on screen
    $('#error').hidden = false
  }
}

// Zoom: null = mermaid's default fit (shrink to the pane, never enlarge);
// otherwise a multiple of the diagram's natural size.
let zoom = null
const ZOOM_MIN = 0.1, ZOOM_MAX = 8, ZOOM_STEP = 1.25

function applyZoom() {
  const svg = $('#preview svg')
  if (!svg) return
  const [, , w, h] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number)
  if (zoom === null) {
    svg.style.removeProperty('width')
    svg.style.removeProperty('height')
    svg.style.maxWidth = `${w}px`
  } else {
    svg.style.maxWidth = 'none'
    svg.style.width = `${w * zoom}px`
    svg.style.height = `${h * zoom}px`
  }
  $('#zoomReset').textContent = zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`
}

function zoomBy(factor) {
  const svg = $('#preview svg')
  if (!svg) return
  const current = zoom ?? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor))
  applyZoom()
}

// Drag to pan with the mouse (touch already pans natively).
const pane = $('#preview')
let drag = null
pane.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  const r = pane.getBoundingClientRect()
  if (e.clientX - r.left > pane.clientWidth || e.clientY - r.top > pane.clientHeight) return // on a scrollbar
  drag = { x: e.clientX, y: e.clientY, left: pane.scrollLeft, top: pane.scrollTop }
  pane.setPointerCapture(e.pointerId)
  pane.classList.add('dragging')
  e.preventDefault() // don't select diagram text while dragging
})
pane.addEventListener('pointermove', e => {
  if (!drag) return
  pane.scrollLeft = drag.left - (e.clientX - drag.x)
  pane.scrollTop = drag.top - (e.clientY - drag.y)
})
const endDrag = () => { drag = null; pane.classList.remove('dragging') }
pane.addEventListener('pointerup', endDrag)
pane.addEventListener('pointercancel', endDrag)

$('#zoomIn').addEventListener('click', () => zoomBy(ZOOM_STEP))
$('#zoomOut').addEventListener('click', () => zoomBy(1 / ZOOM_STEP))
$('#zoomReset').addEventListener('click', () => { zoom = null; applyZoom() })

// --- syntax highlighting (Prism, loaded as a classic script in index.html) ---

// Prism's mermaid grammar predates these diagram types and statements.
Prism.languages.mermaid.keyword.unshift({
  pattern: /(^[ \t]*)(?:mindmap|timeline|quadrantChart|sankey(?:-beta)?|xychart(?:-beta)?|block(?:-beta)?|architecture(?:-beta)?|kanban|packet(?:-beta)?|radar-beta|treemap(?:-beta)?|C4(?:Context|Container|Component|Dynamic|Deployment)|title|section|dateFormat|axisFormat|commit|branch|checkout|merge)(?![\w$-])/m,
  lookbehind: true,
  greedy: true,
})

const hl = $('#hl')
function highlight() {
  // trailing space: a <pre> drops a final empty line that the textarea shows
  hl.innerHTML = Prism.highlight(editor.value, Prism.languages.mermaid, 'mermaid') + ' '
  hl.scrollTop = editor.scrollTop
  hl.scrollLeft = editor.scrollLeft
}
editor.addEventListener('scroll', () => {
  hl.scrollTop = editor.scrollTop
  hl.scrollLeft = editor.scrollLeft
})

let timer = null
editor.addEventListener('input', () => {
  highlight()
  draft.set(editor.value) // a shared diagram is read-only, so this only ever saves your own work
  clearTimeout(timer)
  timer = setTimeout(preview, 250)
})

// Tab inserts spaces instead of leaving the editor (execCommand keeps undo working).
editor.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    document.execCommand('insertText', false, '    ')
  }
})

// --- export ---

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Renders for export and returns the <svg> element with explicit pixel size.
async function exportSvg() {
  const text = await renderSvg(editor.value, EXPORT)
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
  const [, , w, h] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number)
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)
  svg.style.removeProperty('max-width')
  return { svg, w, h }
}

async function toRaster(svg, w, h, scale, type) {
  svg.setAttribute('width', w * scale)
  svg.setAttribute('height', h * scale)
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
  await img.decode()
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(w * scale), height: Math.ceil(h * scale) })
  const ctx = canvas.getContext('2d')
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(resolve, type, 0.95))
}

async function toPdf(svg, w, h) {
  const [{ jsPDF }] = await Promise.all([import(LIBS.jspdf), import(LIBS.svg2pdf)]) // svg2pdf adds doc.svg()
  const m = 24
  const doc = new jsPDF({ unit: 'pt', format: [w + 2 * m, h + 2 * m], orientation: w > h ? 'landscape' : 'portrait' })
  document.body.append(svg) // svg2pdf reads computed styles, so the element must be in the page
  // svg2pdf ignores markerUnits="userSpaceOnUse" and scales every marker by the
  // line's stroke width, so pre-divide those markers (arrowheads) by it.
  for (const marker of svg.querySelectorAll('marker[markerUnits="userSpaceOnUse"]')) {
    const line = svg.querySelector(`[marker-end="url(#${marker.id})"], [marker-start="url(#${marker.id})"]`)
    const sw = line ? parseFloat(getComputedStyle(line).strokeWidth) || 1 : 1
    marker.setAttribute('markerUnits', 'strokeWidth')
    marker.setAttribute('markerWidth', marker.getAttribute('markerWidth') / sw)
    marker.setAttribute('markerHeight', marker.getAttribute('markerHeight') / sw)
  }
  try {
    await doc.svg(svg, { x: m, y: m, width: w, height: h })
  } finally {
    svg.remove()
  }
  return doc.output('blob')
}

$('#export').addEventListener('click', async () => {
  const btn = $('#export')
  const format = $('#format').value
  btn.disabled = true
  showMsg('')
  try {
    const { svg, w, h } = await exportSvg()
    if (format === 'svg') {
      download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), 'diagram.svg')
    } else if (format === 'pdf') {
      download(await toPdf(svg, w, h), 'diagram.pdf')
    } else {
      download(await toRaster(svg, w, h, Number($('#scale').value), `image/${format}`), `diagram.${format === 'jpeg' ? 'jpg' : 'png'}`)
    }
  } catch (e) {
    showMsg(`Export failed: ${e.message || e}`)
  } finally {
    btn.disabled = false
  }
})

$('#format').addEventListener('change', () => {
  $('#scale').hidden = !['png', 'jpeg'].includes($('#format').value)
})

// --- sharing ---

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message || `${name} failed (${res.status})`)
  return body
}

const fmtDate = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

$('#share').addEventListener('click', async () => {
  const btn = $('#share')
  const days = Number($('#days').value)
  btn.disabled = true
  showMsg('')
  try {
    if (new TextEncoder().encode(editor.value).length > 100_000) throw new Error('diagram is over 100 KB')
    const secret = C.newSecret()
    const { id, key } = await C.deriveShare(secret)
    const expires = await rpc('create_share', { p_id: id, p_data: await C.encryptText(key, editor.value), p_days: days })
    $('#shareLink').value = `${location.origin}${location.pathname}#${secret}`
    $('#shareNote').textContent = `Expires ${fmtDate(expires)}`
    $('#shareBar').hidden = false
    $('#shareLink').select()
  } catch (e) {
    showMsg(`Couldn't create link: ${e.message}`)
  } finally {
    btn.disabled = false
  }
})

$('#copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#shareLink').value)
  $('#copy').textContent = 'Copied'
  setTimeout(() => { $('#copy').textContent = 'Copy' }, 1500)
})

// --- start ---

// Shared diagrams open read-only. "Edit a copy" turns it into your own local
// draft (nothing is uploaded); "Get link" then shares your version as a new link.
function setViewing(on) {
  editor.readOnly = on
  $('#sharedBar').hidden = !on
  $('#shareGroup').hidden = on
}

$('#fork').addEventListener('click', () => {
  const mine = draft.get()
  if (mine && mine !== SAMPLE && mine !== editor.value &&
      !confirm('Your copy replaces the diagram you were working on. Continue?')) return
  draft.set(editor.value)
  history.replaceState(null, '', location.pathname) // drop the secret from the URL
  setViewing(false)
  $('#shareBar').hidden = true
  editor.focus()
})

// #<secret> opens a shared diagram.
const secret = location.hash.match(/^#([A-Za-z0-9_-]{22})$/)?.[1] ?? null
addEventListener('hashchange', () => location.reload())

let shared = null
if (secret) {
  editor.readOnly = true // until we know what to show
  try {
    const { id, key } = await C.deriveShare(secret)
    const [row] = await rpc('get_share', { p_id: id })
    if (!row) throw new Error('This link has expired or never existed.')
    try { shared = await C.decryptText(key, row.data) } catch { throw new Error('This link is damaged or incomplete.') }
    $('#sharedNote').textContent = `Shared diagram, read-only · expires ${fmtDate(row.expires_at)}.`
  } catch (e) {
    showMsg(`${e.message} Showing your own diagram instead.`)
  }
}
editor.value = shared ?? draft.get() ?? SAMPLE
highlight()
setViewing(shared !== null)
preview()
