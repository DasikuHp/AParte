// Front de AParte. Sin framework: cada "vista" es un <div class="view"> y
// showView() decide cuál se ve. Los datos van y vienen de la API con fetch.

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════
async function apiFetch(path, opts = {}) {
    const r = await fetch('/api' + path, {
        credentials: 'same-origin',
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.startsWith('/auth/')) { showView('login'); }
    if (!r.ok) {
        const err = new Error(body.error || 'HTTP ' + r.status);
        err.status = r.status;
        err.body = body;
        throw err;
    }
    return body;
}

const API = {
    tecnicos: () => apiFetch('/tecnicos'),
    me: () => apiFetch('/auth/me'),
    login: (tech, password) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ tech, password }) }),
    logout: () => apiFetch('/auth/logout', { method: 'POST' }),
    getPartes: (filters = {}) => apiFetch('/partes?' + new URLSearchParams(filters)),
    getParte: (id) => apiFetch('/partes/' + id),
    saveParte: (data) => apiFetch('/partes', { method: 'POST', body: JSON.stringify(data) }),
    updateParte: (id, data) => apiFetch('/partes/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    sendEmail: (id, opts) => apiFetch('/partes/' + id + '/send', { method: 'POST', body: JSON.stringify(opts) }),
    async uploadPhoto(file) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'No se pudo subir la foto');
        return body;
    },
};

// ═══════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════
const S = {
    tecnicos: [],      // lista pública (login, historial)
    perfil: null,      // técnico con sesión: nombre, NIF, firma...
    view: 'login',
    prevView: null,
    desp: 'SI',
    mats: [],
    photos: [],        // [{ url }]
    sigPad: null,
    pendingSig: null,  // firma del cliente a pintar cuando el canvas esté listo
    draftId: null,
    current: null,     // parte abierto (para saber técnico, estado y si es editable)
    histFilter: 'all',
};

function techById(id) { return S.tecnicos.find(t => t.id === id); }

// ═══════════════════════════════════════════════════════════
// NAVEGACIÓN
// ═══════════════════════════════════════════════════════════
function showView(name, fromBack = false) {
    if (!fromBack) S.prevView = S.view;
    S.view = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');

    const nav = document.getElementById('main-nav');
    const back = document.getElementById('nav-back');
    if (name === 'login') {
        nav.style.display = 'none';
    } else {
        nav.style.display = 'flex';
        back.style.display = (name === 'dashboard') ? 'none' : 'flex';
    }

    if (name === 'dashboard') initDash();
    if (name === 'form') initForm();
    if (name === 'preview') buildPreview();
    if (name === 'history') { S.histFilter = 'all'; document.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', i === 0)); renderHistory(); }
    window.scrollTo(0, 0);
}

function goBack() {
    const back = S.prevView && S.prevView !== S.view ? S.prevView : 'dashboard';
    showView(back, true);
}
function goToForm() { S.draftId = null; S.current = null; clearForm(); showView('form'); }
function goToPreview() { showView('preview'); }

// ═══════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════
function renderLogin() {
    document.getElementById('tech-cards').innerHTML = S.tecnicos.map(t => `
        <div class="tech-card" onclick="selectTech('${esc(t.id)}')">
            <div class="tc-avatar" style="background:${esc(t.color)}22;color:${esc(t.color)}">${esc(t.iniciales)}</div>
            <div class="tc-name">${esc(t.nombre)}</div>
            <div class="tc-company">${esc(t.empresa)}</div>
        </div>`).join('');
    document.getElementById('tech-chips').innerHTML = S.tecnicos.map(t =>
        `<div class="chip" onclick="setChip('tech:${esc(t.id)}',this)">${esc(t.nombreCorto || t.nombre)}</div>`).join('');
}

let loginTech = null;
function selectTech(id) {
    loginTech = id;
    document.getElementById('login-title').textContent = 'Entrar como ' + (techById(id)?.nombre || id);
    document.getElementById('login-pass').value = '';
    document.getElementById('login-error').textContent = '';
    document.getElementById('modal-login').classList.add('open');
    setTimeout(() => document.getElementById('login-pass').focus(), 50);
}

async function doLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    try {
        const { perfil } = await API.login(loginTech, document.getElementById('login-pass').value);
        closeModal('modal-login');
        enterSession(perfil);
    } catch (err) {
        document.getElementById('login-error').textContent = err.message;
    } finally {
        btn.disabled = false;
    }
}

function enterSession(perfil) {
    S.perfil = perfil;
    const badge = document.getElementById('nav-badge');
    badge.textContent = perfil.iniciales;
    badge.style.background = perfil.color;
    document.getElementById('nav-name').textContent = perfil.nombreCorto || perfil.nombre;
    document.getElementById('nav-logo').style.color = perfil.color;
    document.documentElement.style.setProperty('--accent', perfil.color);
    showView('dashboard');
}

function confirmChangeTech() { document.getElementById('modal-tech').classList.add('open'); }
async function doChangeTech() {
    closeModal('modal-tech');
    await API.logout().catch(() => {});
    S.perfil = null;
    showView('login');
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function initDash() {
    if (!S.perfil) return;
    const h = new Date().getHours();
    const g = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    document.getElementById('dash-greeting').textContent = `${g}, ${S.perfil.nombreCorto || S.perfil.nombre}`;
    document.getElementById('dash-sub').textContent = `${S.perfil.empresa} · ${fmtDateLong(new Date())}`;
    const rows = (await API.getPartes({ tech: S.perfil.id })).slice(0, 6);
    document.getElementById('recent-list').innerHTML = rows.length
        ? rows.map(parteHTML).join('')
        : `<div class="empty-state"><div class="empty-icon">📄</div><p>Sin partes aún. ¡Crea el primero!</p></div>`;
}

function parteHTML(p) {
    const badge = p.status === 'sent'
        ? `<span class="badge badge-sent">Enviado</span>`
        : `<span class="badge badge-draft">Borrador</span>`;
    const tecnico = techById(p.tech)?.nombre || p.tech;
    return `<div class="parte-item" onclick="viewParte('${esc(p.id)}')">
    <div class="pi-left">
      <h4>${esc(p.empresa || 'Sin cliente')}</h4>
      <p>${esc(tecnico)} · ${esc(fmtDate(p.fecha))}</p>
    </div>
    <div class="pi-right">${badge}<div class="pi-hours">${esc(p.totalHoras || '')}</div></div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
// FORMULARIO
// ═══════════════════════════════════════════════════════════
function initForm() {
    if (!document.getElementById('f-fecha').value)
        document.getElementById('f-fecha').value = today();

    // Firma del cliente. Se espera dos frames para que el canvas tenga su tamaño real.
    // Si ya había firma (por ejemplo, al volver de la vista previa) se conserva.
    const canvas = document.getElementById('sig-canvas');
    const initPad = () => {
        const ratio = window.devicePixelRatio || 1;
        const w = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 300;
        const h = 140;
        const previo = S.sigPad ? S.sigPad.toData() : null;
        canvas.width = Math.floor(w * ratio);
        canvas.height = Math.floor(h * ratio);
        canvas.getContext('2d').scale(ratio, ratio);
        if (!S.sigPad) S.sigPad = new SignaturePad(canvas, { minWidth: 1, maxWidth: 3, penColor: '#18263A' });
        S.sigPad.clear();
        if (previo && previo.length) S.sigPad.fromData(previo);
        if (S.pendingSig) {
            S.sigPad.fromDataURL(S.pendingSig, { ratio, width: w, height: h });
            S.pendingSig = null;
        }
    };
    requestAnimationFrame(() => requestAnimationFrame(initPad));
    renderMats();
    renderPhotos();

    // Firma del técnico: la imagen viene de su perfil (config/tecnicos.json).
    const perfil = S.perfil || {};
    document.getElementById('sig-tech-name').textContent = perfil.nombre || '';
    const img = document.getElementById('sig-tech-img');
    const conFirma = Boolean(perfil.firma);
    img.src = conFirma ? perfil.firma : '';
    img.style.display = conFirma ? 'block' : 'none';
    document.getElementById('sig-tech-icon').style.display = conFirma ? 'none' : '';
    document.getElementById('sig-tech-note').style.display = conFirma ? 'none' : '';
}

function clearForm() {
    ['f-empresa', 'f-direccion', 'f-contacto', 'f-tel', 'f-email-cli',
        'f-entrada', 'f-salida', 'f-horas', 'f-desc', 'f-pendiente',
        'f-email-para', 'f-email-cc'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    document.getElementById('f-fecha').value = today();
    S.desp = 'SI'; setDesp('SI');
    S.mats = []; renderMats();
    S.photos = []; renderPhotos();
    S.pendingSig = null;
    if (S.sigPad) { S.sigPad.off(); S.sigPad = null; }
    if (S.perfil) document.getElementById('f-email-cc').value = S.perfil.ccPorDefecto || '';
}

function setDesp(v) {
    S.desp = v;
    document.getElementById('d-si').className = 'tgl' + (v === 'SI' ? ' tgl-si' : '');
    document.getElementById('d-no').className = 'tgl' + (v === 'NO' ? ' tgl-no' : '');
}

// ── MATERIALES ──────────────────────────────────────────────
function renderMats() {
    const tb = document.getElementById('mat-body');
    if (S.mats.length === 0) {
        tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:14px;color:#bbb;font-size:12px">Sin materiales añadidos</td></tr>`;
        return;
    }
    tb.innerHTML = S.mats.map((m, i) => {
        const total = (parseFloat(m.qty) || 0) * (parseFloat(m.price) || 0);
        return `<tr>
      <td><input type="text" value="${esc(m.desc || '')}" placeholder="Descripción" onchange="updMat(${i},'desc',this.value)"></td>
      <td><input type="number" value="${esc(m.qty ?? '')}" placeholder="1" min="0" style="text-align:center" onchange="updMat(${i},'qty',this.value)"></td>
      <td><input type="number" value="${esc(m.price ?? '')}" placeholder="0.00" min="0" step="0.01" onchange="updMat(${i},'price',this.value)"></td>
      <td class="mat-total">${total > 0 ? total.toFixed(2) : '—'}</td>
      <td><button class="btn-icon" onclick="delMat(${i})">✕</button></td>
    </tr>`;
    }).join('');
}
function addMat() { S.mats.push({ desc: '', qty: 1, price: 0 }); renderMats(); }
function delMat(i) { S.mats.splice(i, 1); renderMats(); }
function updMat(i, k, v) {
    S.mats[i][k] = k === 'desc' ? v : parseFloat(v) || 0;
    // Solo se actualiza la celda del total para no perder el foco del input
    const rows = document.getElementById('mat-body').querySelectorAll('tr');
    if (rows[i]) {
        const total = (S.mats[i].qty || 0) * (S.mats[i].price || 0);
        rows[i].querySelector('.mat-total').textContent = total > 0 ? total.toFixed(2) : '—';
    }
}

// ── FOTOS ───────────────────────────────────────────────────
async function handlePhotos(e) {
    for (const f of Array.from(e.target.files)) {
        try {
            const r = await API.uploadPhoto(f);
            S.photos.push({ url: r.url });
        } catch (err) {
            toast('❌ ' + err.message);
        }
    }
    renderPhotos();
    e.target.value = '';
}
function renderPhotos() {
    document.getElementById('photo-grid').innerHTML = S.photos.map((p, i) => `
    <div class="photo-wrap">
      <img src="${esc(p.url)}" alt="foto ${i + 1}">
      <button class="photo-del" onclick="delPhoto(${i})">✕</button>
    </div>`).join('');
}
function delPhoto(i) { S.photos.splice(i, 1); renderPhotos(); }
function clearSig() { if (S.sigPad) S.sigPad.clear(); }

// ── RECOGER DATOS ───────────────────────────────────────────
// Devuelve el parte con los mismos nombres de campo que la API.
function collectData() {
    return {
        empresa: v('f-empresa'),
        direccion: v('f-direccion'),
        contacto: v('f-contacto'),
        telefono: v('f-tel'),
        emailCliente: v('f-email-cli'),
        fecha: v('f-fecha'), // yyyy-mm-dd
        horaEntrada: v('f-entrada'),
        horaSalida: v('f-salida'),
        totalHoras: v('f-horas'),
        desplazamiento: S.desp,
        descripcion: v('f-desc'),
        pendiente: v('f-pendiente'),
        mats: JSON.parse(JSON.stringify(S.mats)),
        emailPara: v('f-email-para'),
        emailCC: v('f-email-cc'),
        fotos: S.photos.map(p => p.url),
        firmaCliente: S.sigPad && !S.sigPad.isEmpty() ? S.sigPad.toDataURL('image/png') : null,
    };
}

// Técnico del parte abierto: el de la sesión o, si es de otro, sus datos públicos.
function techOfCurrent() {
    if (!S.current || S.current.tech === S.perfil?.id) return S.perfil || {};
    return techById(S.current.tech) || {};
}

async function saveParte() {
    const d = collectData();
    if (S.draftId) S.current = await API.updateParte(S.draftId, d);
    else { S.current = await API.saveParte(d); S.draftId = S.current.id; }
    return S.current;
}

async function saveDraft() {
    try {
        await saveParte();
        toast(S.current.status === 'sent' ? '✓ Cambios guardados' : '✓ Borrador guardado');
    } catch (err) {
        toast('❌ ' + err.message);
    }
}

// ═══════════════════════════════════════════════════════════
// PREVIEW
// ═══════════════════════════════════════════════════════════
function buildPreview() {
    const d = collectData();
    const t = techOfCurrent();
    set('p-empresa', d.empresa); set('p-dir', d.direccion); set('p-contacto', d.contacto);
    set('p-tel', d.telefono); set('p-emailcli', d.emailCliente);
    set('p-tecnico', t.nombre); set('p-entrada', d.horaEntrada);
    set('p-salida', d.horaSalida); set('p-fecha', fmtDate(d.fecha));
    set('p-horas', d.totalHoras); set('p-desp', d.desplazamiento);
    set('p-desc', d.descripcion); set('p-pendiente', d.pendiente);
    set('p-footer', t.nif
        ? `${t.nombre} · NIF: ${t.nif} · ${t.direccion || ''} · Móvil ${t.movil || ''} · ${t.email || ''} · ${t.web || ''}`
        : (t.empresa || ''));

    // Materiales
    const mat = document.getElementById('p-mat');
    if (d.mats.length > 0) {
        const totalGlobal = d.mats.reduce((s, m) => s + (m.qty || 0) * (m.price || 0), 0);
        mat.innerHTML = `<thead><tr>
      <th>Descripción</th><th style="width:50px">Cant.</th>
      <th style="width:65px">P.Unit €</th><th style="width:65px">Total €</th>
    </tr></thead><tbody>
    ${d.mats.map(m => `<tr>
      <td>${esc(m.desc || '')}</td>
      <td style="text-align:center">${esc(m.qty ?? '')}</td>
      <td style="text-align:right">${(m.price || 0).toFixed(2)}</td>
      <td style="text-align:right">${((m.qty || 0) * (m.price || 0)).toFixed(2)}</td>
    </tr>`).join('')}
    <tr><td colspan="3" style="text-align:right;font-weight:700;padding:4px 8px;background:#f5f5f5">TOTAL:</td>
    <td class="td-total" style="text-align:right;padding:4px 6px">${totalGlobal.toFixed(2)} €</td></tr>
    </tbody>`;
    } else {
        mat.innerHTML = '<thead></thead><tbody><tr><td colspan="4" style="color:#aaa;padding:8px;font-size:10px;text-align:center">Sin materiales</td></tr></tbody>';
    }

    // Firma del cliente (si se está viendo un parte guardado y el canvas no se ha tocado, la guardada)
    const firmaCli = d.firmaCliente || S.pendingSig || S.current?.firmaCliente;
    const sc = document.getElementById('p-sig-cli');
    if (firmaCli) { sc.src = firmaCli; sc.style.display = 'block'; } else { sc.style.display = 'none'; }

    // Firma del técnico
    const st = document.getElementById('p-sig-tech');
    const sph = document.getElementById('p-sig-tech-ph');
    if (t.firma) { st.src = t.firma; st.style.display = 'block'; sph.style.display = 'none'; }
    else { st.style.display = 'none'; sph.style.display = 'block'; }

    // Botones: un parte de otro técnico solo se consulta.
    const editable = !S.current || S.current.editable !== false;
    document.getElementById('btn-edit').style.display = editable ? '' : 'none';
    document.getElementById('btn-gen').style.display = editable ? '' : 'none';
    document.getElementById('btn-gen').textContent = S.current?.status === 'sent' ? 'Generar PDF y reenviar' : 'Generar PDF y Enviar';
    document.getElementById('btn-pdf').style.display = S.current?.tienePdf ? '' : 'none';
}

function openSavedPdf() {
    if (S.current) window.open(`/api/partes/${S.current.id}/pdf`, '_blank', 'noopener');
}

// ═══════════════════════════════════════════════════════════
// GENERAR PDF Y ENVIAR
// ═══════════════════════════════════════════════════════════
function confirmSend() {
    const d = collectData();
    const ccList = splitEmails(d.emailCC);
    document.getElementById('modal-send-body').innerHTML =
        `<strong>Para:</strong> ${esc(d.emailPara || '—')}<br>` +
        `<strong>CC:</strong> ${esc(ccList.join(', ') || '—')}<br><br>` +
        `Se adjuntará el PDF del parte de servicio.`;
    document.getElementById('modal-send').classList.add('open');
}

async function doSend() {
    closeModal('modal-send');
    const d = collectData();
    if (!d.emailPara) { toast('❌ Falta el email del destinatario'); return; }
    const btn = document.getElementById('btn-gen');
    btn.innerHTML = '<span class="spinner"></span> Generando...';
    btn.disabled = true;
    try {
        // 1) Guardar el parte (sin tocar su estado). 2) Generar el PDF. 3) Enviar.
        // El servidor solo lo marca como enviado si el correo sale.
        const saved = await saveParte();
        const pdfB64 = await generatePDF();
        const fname = `Parte_${(d.empresa || 'Servicio').replace(/\s+/g, '_')}_${fmtDate(d.fecha).replace(/\//g, '-')}.pdf`;
        downloadPDF(pdfB64, fname);
        try {
            const r = await API.sendEmail(saved.id, { para: d.emailPara, cc: splitEmails(d.emailCC), pdfBase64: pdfB64, filename: fname });
            S.current = r.parte;
            toast(r.simulated ? '✓ PDF generado (demo: el correo no se envía de verdad)' : '✓ Parte generado y enviado');
            setTimeout(() => showView('dashboard'), 2400);
        } catch (err) {
            toast('⚠️ PDF descargado, pero el correo no salió: ' + err.message);
        }
    } catch (err) {
        console.error(err);
        toast('❌ ' + (err.message || 'Error al generar el PDF'));
    } finally {
        btn.disabled = false;
        buildPreview();
    }
}

async function generatePDF() {
    const { jsPDF } = window.jspdf;
    const el = document.getElementById('parte-doc');
    // html2canvas "fotografía" la vista previa; el PDF es esa imagen en un A4.
    const canvas = await html2canvas(el, {
        scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false
    });
    const img = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = (canvas.height * pw) / canvas.width;
    pdf.addImage(img, 'JPEG', 0, 0, pw, ph);
    pdf.setProperties({
        title: 'Parte de Servicio',
        subject: document.getElementById('p-empresa').textContent,
        author: techOfCurrent().nombre || '',
        creator: 'AParte',
    });
    return pdf.output('datauristring').split(',')[1];
}

function downloadPDF(b64, fname) {
    const a = document.createElement('a');
    a.href = 'data:application/pdf;base64,' + b64;
    a.download = fname;
    a.click();
}

// ═══════════════════════════════════════════════════════════
// HISTORIAL
// ═══════════════════════════════════════════════════════════
async function renderHistory() {
    const q = document.getElementById('h-search')?.value || '';
    const f = S.histFilter;
    const filters = { q };
    if (f === 'sent' || f === 'draft') filters.status = f;
    if (f.startsWith('tech:')) filters.tech = f.slice(5);

    const rows = await API.getPartes(filters);
    document.getElementById('history-list').innerHTML = rows.length
        ? rows.map(parteHTML).join('')
        : `<div class="empty-state"><div class="empty-icon">🔍</div><p>No se encontraron partes</p></div>`;
}

function setChip(filter, el) {
    S.histFilter = filter;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
    renderHistory();
}

// Abre un parte guardado. Si es propio se puede editar; si es de otro técnico,
// se muestra directamente la vista previa en modo consulta.
async function viewParte(id) {
    let p;
    try { p = await API.getParte(id); } catch (err) { toast('❌ ' + err.message); return; }
    clearForm();
    S.draftId = p.editable ? p.id : null;
    S.current = p;
    const fields = {
        'f-empresa': p.empresa, 'f-direccion': p.direccion,
        'f-contacto': p.contacto, 'f-tel': p.telefono,
        'f-email-cli': p.emailCliente, 'f-fecha': p.fecha,
        'f-entrada': p.horaEntrada, 'f-salida': p.horaSalida,
        'f-horas': p.totalHoras, 'f-desc': p.descripcion,
        'f-pendiente': p.pendiente, 'f-email-para': p.emailPara,
        'f-email-cc': p.emailCC,
    };
    Object.entries(fields).forEach(([fid, val]) => {
        const el = document.getElementById(fid);
        if (el) el.value = val ?? '';
    });
    if (p.desplazamiento) setDesp(p.desplazamiento);
    S.mats = Array.isArray(p.mats) ? p.mats : [];
    S.photos = (p.fotos || []).map(url => ({ url }));
    S.pendingSig = p.firmaCliente || null;
    showView(p.editable ? 'form' : 'preview');
    toast(`${p.empresa || 'Sin cliente'} · ${p.status === 'sent' ? '✓ Enviado' : 'Borrador'}`);
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function v(id) { return (document.getElementById(id) || {}).value || ''; }
function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val || ''; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function splitEmails(s) { return String(s || '').split(',').map(e => e.trim()).filter(Boolean); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(iso) { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function fmtDateLong(d) { return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); }
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { tecnicos, demo } = await API.tecnicos();
        S.tecnicos = tecnicos;
        document.getElementById('demo-note').style.display = demo ? '' : 'none';
        renderLogin();
    } catch (err) {
        toast('❌ No se pudo conectar con el servidor');
    }
    // Si la sesión sigue viva (recarga de página), se entra directamente.
    try {
        const { perfil } = await API.me();
        enterSession(perfil);
    } catch {
        showView('login');
    }

    window.addEventListener('resize', () => {
        if (S.view === 'form' && S.sigPad) {
            const c = document.getElementById('sig-canvas');
            const ratio = window.devicePixelRatio || 1;
            const data = S.sigPad.toData();
            c.width = Math.floor((c.offsetWidth || 300) * ratio);
            c.height = Math.floor(140 * ratio);
            c.getContext('2d').scale(ratio, ratio);
            S.sigPad.fromData(data);
        }
    });
});
