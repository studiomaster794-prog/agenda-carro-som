(() => {
  const TZ = "America/Sao_Paulo";
  const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const OPEN_DAYS = new Set([1, 2, 3, 4, 5, 6]);
  const WINDOWS = [
    { start: hm("08:30"), end: hm("11:30") },
    { start: hm("14:00"), end: hm("18:00") },
  ];
  const SLOT = 30;
  const COLORS = ["#c23b2e", "#1c2740", "#1f7a6a", "#3d4f7a", "#8a4a1f", "#2a9d8f", "#5c3d7a"];
  const SETTINGS_KEY = "seiko-carro-som-settings";
  const PAY_KEY = "seiko-carro-som-pagamentos";
  const DISC_KEY = "seiko-carro-som-descontos";
  const DEFAULT_RATE = 50;

  const $ = (id) => document.getElementById(id);
  const calendarEl = $("calendar");
  const logEl = $("log");
  const cmd = $("cmd");
  const periodTitle = $("periodTitle");
  const dlg = $("editDlg");
  const editForm = $("editForm");
  const editErr = $("editErr");
  const serieHint = $("serieHint");

  let view = "semana";
  let cursor = startOfDay(now());
  let pending = null;
  let db;
  let settings = loadSettings();
  let payments = loadPayments();
  let discounts = [];
  persistDiscounts();
  let payTarget = null;
  let discTarget = null;
  let dashRange = "semana";
  let histCliente = "";
  let histPago = "todos";
  let pagoEditing = false;
  let addWaitName = false;
  const addState = { cliente: "", month: startOfDay(now()), days: new Set(), step: "dias" };
  const CMD_PLACEHOLDER = "Ex.: Coloca Maria segunda, quarta e sexta às 9h, 1 hora cada dia";

  function hm(s) {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function now() {
    return new Date();
  }
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function isoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function fromIso(s) {
    const [y, m, da] = s.split("-").map(Number);
    return new Date(y, m - 1, da);
  }
  function minutesToHHMM(min) {
    return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  }
  function fmtLong(d) {
    return d.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: TZ,
    });
  }
  function weekday(d) {
    return d.getDay();
  }
  function isOpenDay(d) {
    return OPEN_DAYS.has(weekday(d));
  }
  function colorFor(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }
  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  }
  function clampDur(min) {
    const n = Math.round(min / SLOT) * SLOT;
    return Math.max(SLOT, n);
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const v = Number(s.valorHora);
      return { valorHora: Number.isFinite(v) && v >= 0 ? v : DEFAULT_RATE };
    } catch {
      return { valorHora: DEFAULT_RATE };
    }
  }
  function persistSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    const hint = $("rateHint");
    if (hint) hint.textContent = money(settings.valorHora) + "/h";
  }
  function loadPayments() {
    try {
      const raw = JSON.parse(localStorage.getItem(PAY_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizePayment).filter(Boolean);
    } catch {
      return [];
    }
  }
  function normalizePayment(p) {
    if (!p || !String(p.cliente || "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.data || ""))) return null;
    const valor = round2(p.valor);
    if (!(valor > 0)) return null;
    return {
      id: String(p.id || uid()),
      cliente: String(p.cliente).trim(),
      data: String(p.data),
      valor,
      createdAt: p.createdAt || new Date().toISOString(),
    };
  }
  function persistPayments() {
    localStorage.setItem(PAY_KEY, JSON.stringify(payments));
  }
  function loadDiscounts() {
    try {
      const raw = JSON.parse(localStorage.getItem(DISC_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizePayment).filter(Boolean);
    } catch {
      return [];
    }
  }
  function persistDiscounts() {
    localStorage.setItem(DISC_KEY, JSON.stringify(discounts));
  }
  function money(n) {
    return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }
  function fmtHours(min) {
    const h = (Number(min) || 0) / 60;
    return String(h).replace(".", ",") + "h";
  }
  function withFinance(item) {
    const desconto = Number(item.desconto);
    const descontoHora = Number(item.descontoHora);
    return {
      ...item,
      desconto: Number.isFinite(desconto) && desconto > 0 ? round2(desconto) : 0,
      descontoHora: Number.isFinite(descontoHora) && descontoHora > 0 ? round2(descontoHora) : 0,
      pago: item.pago === true,
    };
  }
  function figures(item, rate = settings.valorHora) {
    const horas = (item.duracaoMin || 0) / 60;
    const bruto = round2(horas * rate);
    const descFixo = Math.max(0, Number(item.desconto) || 0);
    let descHora = Math.max(0, Number(item.descontoHora) || 0);
    if (descHora > rate) descHora = 0;
    const desconto = Math.min(bruto, round2(descFixo + horas * descHora));
    const total = Math.max(0, round2(bruto - desconto));
    return {
      horas,
      bruto,
      desconto,
      total,
      recebido: item.pago ? total : 0,
      pendente: item.pago ? 0 : total,
    };
  }

  function inWindows(start, end) {
    return WINDOWS.some((w) => start >= w.start && end <= w.end);
  }
  function windowsOn(date) {
    if (!isOpenDay(date)) return [];
    return WINDOWS.map((w) => ({ ...w }));
  }
  function slotsOfDay() {
    const out = [];
    for (const w of WINDOWS) {
      for (let t = w.start; t < w.end; t += SLOT) out.push(t);
    }
    return out;
  }
  function overlap(a0, a1, b0, b1) {
    return a0 < b1 && b0 < a1;
  }

  const store = {
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("seiko-carro-som", 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("compromissos")) {
            const s = d.createObjectStore("compromissos", { keyPath: "id" });
            s.createIndex("data", "data");
            s.createIndex("serieId", "serieId");
            s.createIndex("status", "status");
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    tx(mode = "readonly") {
      return db.transaction("compromissos", mode).objectStore("compromissos");
    },
    all() {
      return new Promise((resolve, reject) => {
        const r = this.tx().getAll();
        r.onsuccess = () => resolve((r.result || []).map(withFinance));
        r.onerror = () => reject(r.error);
      });
    },
    put(item) {
      return new Promise((resolve, reject) => {
        const r = this.tx("readwrite").put(item);
        r.onsuccess = () => resolve(item);
        r.onerror = () => reject(r.error);
      });
    },
    del(id) {
      return new Promise((resolve, reject) => {
        const r = this.tx("readwrite").delete(id);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    },
    async importAll(items) {
      const existing = await this.all();
      const byId = new Map(existing.map((x) => [x.id, x]));
      for (const raw of items) {
        const prev = byId.get(raw.id);
        if (prev && (raw.updatedAt || "") < (prev.updatedAt || "")) continue;
        const item = withFinance(raw);
        if (prev) {
          if (!("desconto" in raw)) item.desconto = prev.desconto;
          if (!("descontoHora" in raw)) item.descontoHora = prev.descontoHora;
          if (!("pago" in raw)) item.pago = prev.pago;
        }
        await this.put(item);
      }
    },
  };

  function active(list) {
    return list.filter((x) => x.status === "ativo");
  }
  function onDate(list, iso) {
    return active(list).filter((x) => x.data === iso).sort((a, b) => a.inicioMin - b.inicioMin);
  }
  function conflicts(list, { data, inicioMin, duracaoMin, ignoreId, ignoreSerie }) {
    const end = inicioMin + duracaoMin;
    return onDate(list, data).filter((x) => {
      if (ignoreId && x.id === ignoreId) return false;
      if (ignoreSerie && x.serieId && x.serieId === ignoreSerie) return false;
      return overlap(inicioMin, end, x.inicioMin, x.inicioMin + x.duracaoMin);
    });
  }
  function sameClient(a, b) {
    return stripAccents(String(a || "").toLowerCase()) === stripAccents(String(b || "").toLowerCase());
  }
  function freeRanges(list, data, duracaoMin) {
    const need = duracaoMin || SLOT;
    const wins = windowsOn(fromIso(data));
    const busy = onDate(list, data);
    const ranges = [];
    for (const w of wins) {
      let t = w.start;
      while (t < w.end) {
        const hit = busy.find((x) => overlap(t, t + SLOT, x.inicioMin, x.inicioMin + x.duracaoMin));
        if (hit) {
          t = Math.min(w.end, Math.max(hit.inicioMin + hit.duracaoMin, t + SLOT));
          continue;
        }
        let end = t;
        while (end < w.end && !busy.some((x) => overlap(end, end + SLOT, x.inicioMin, x.inicioMin + x.duracaoMin))) {
          end += SLOT;
        }
        if (end - t >= need) ranges.push([t, end]);
        t = end;
      }
    }
    return ranges;
  }
  function fmtDur(min) {
    if (min % 60 === 0) return min / 60 + " h";
    if (min === 30) return "30 min";
    return String(min / 60).replace(".", ",") + " h";
  }
  function formatFree(list, data, duracaoMin) {
    const need = duracaoMin || SLOT;
    const starts = [];
    for (const [a, b] of freeRanges(list, data, need)) {
      for (let t = a; t + need <= b; t += SLOT) starts.push(t);
    }
    if (!starts.length) return "Sem outra vaga nesse dia pra " + fmtDur(need) + ".";
    return "Horários livres pra " + fmtDur(need) + ": " + starts.map(minutesToHHMM).join(", ") + ".";
  }
  function suggest(list, data, duracaoMin, prefer) {
    const day = fromIso(data);
    const wins = windowsOn(day);
    const tryFrom = [];
    if (prefer != null) tryFrom.push(prefer);
    for (const w of wins) {
      for (let t = w.start; t + duracaoMin <= w.end; t += SLOT) {
        if (prefer != null && t === prefer) continue;
        tryFrom.push(t);
      }
    }
    for (const t of tryFrom) {
      if (!inWindows(t, t + duracaoMin)) continue;
      if (!conflicts(list, { data, inicioMin: t, duracaoMin }).length) return t;
    }
    return null;
  }

  const MONTHS = {
    janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };
  const WD = {
    domingo: 0, segunda: 1, "segunda-feira": 1, terca: 2, terça: 2, "terça-feira": 2, "terca-feira": 2,
    quarta: 3, "quarta-feira": 3, quinta: 4, "quinta-feira": 4, sexta: 5, "sexta-feira": 5,
    sabado: 6, sábado: 6,
  };

  function stripAccents(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function nextWeekday(from, wd) {
    const d = startOfDay(from);
    const diff = (wd - d.getDay() + 7) % 7;
    return addDays(d, diff === 0 ? 0 : diff);
  }
  function mondayOf(d) {
    const x = startOfDay(d);
    const dow = x.getDay();
    return addDays(x, dow === 0 ? -6 : 1 - dow);
  }
  function dateOnWeek(monday, wd) {
    return wd === 0 ? addDays(monday, 6) : addDays(monday, wd - 1);
  }
  function wdName(name) {
    const k = name.toLowerCase().replace("ç", "c");
    return WD[name] ?? WD[k] ?? WD[stripAccents(k)];
  }
  function datesInRange(monday, a, b) {
    const out = [];
    let wd = a;
    for (let i = 0; i < 7; i++) {
      out.push(dateOnWeek(monday, wd));
      if (wd === b) break;
      wd = (wd + 1) % 7;
    }
    return out;
  }
  function resolveDayNumber(n, from) {
    const base = startOfDay(from);
    let d = new Date(base.getFullYear(), base.getMonth(), n);
    if (startOfDay(d) < base) d = new Date(base.getFullYear(), base.getMonth() + 1, n);
    return startOfDay(d);
  }
  function parseTimeToken(raw) {
    const t = raw.replace(",", ".").toLowerCase();
    const m = t.match(/^(\d{1,2})(?:[:h](\d{1,2}))?(?:\s*(h|hs|horas?))?$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = m[2] != null ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  function parseDurationHours(text) {
    const t = text.toLowerCase();
    let found = null;
    const re = /(\d+(?:[.,]\d+)?)\s*(?:h|hs|hora|horas)\b/g;
    let m;
    while ((m = re.exec(t))) found = Number(m[1].replace(",", "."));
    if (found != null) return clampDur(found * 60);
    const cada = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hs|hora|horas)\s*cada/);
    if (cada) return clampDur(Number(cada[1].replace(",", ".")) * 60);
    return null;
  }
  function extractTimes(text) {
    const times = [];
    const re = /(\d{1,2})(?:[:h](\d{2}))?(?:\s*h(?:oras?)?)?/gi;
    let m;
    const lower = text.toLowerCase();
    while ((m = re.exec(text))) {
      const after = lower.slice(m.index + m[0].length, m.index + m[0].length + 14);
      const before = lower.slice(Math.max(0, m.index - 24), m.index);
      const isClockCue = /\b(?:as|às|das)\s*$/.test(before) || /[:h]\d{2}/.test(m[0]);
      if (/\bdia\s+$/.test(before)) continue;
      if (/\b(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?\s+$/.test(before) && !isClockCue) continue;
      if (!isClockCue && /^\s*(h|hs|hora|horas)\b/.test(after)) continue;
      const h = Number(m[1]);
      const min = m[2] != null ? Number(m[2]) : 0;
      if (h > 23 || min > 59) continue;
      if (h === 0 && !m[2] && !/0\s*h/.test(m[0])) continue;
      if (h < 7 && min === 0 && !m[2] && !isClockCue) continue;
      times.push({ min: h * 60 + min, index: m.index });
    }
    return times;
  }

  function parseIntent(raw) {
    const text = raw.replace(/\s+/g, " ").trim();
    const low = text.toLowerCase();
    const intent = classify(low);
    const base = { intent, raw: text, missing: [], slots: [] };

    if (intent === "help" || intent === "unknown") return base;
    if (intent === "show") return Object.assign(base, parseWhen(low));
    if (intent === "free") return Object.assign(base, parseWhen(low), { period: periodOf(low) });
    if (intent === "cancel") return Object.assign(base, parseWhen(low), { cliente: parseClient(text, low) });
    if (intent === "move") {
      const times = extractTimes(low);
      const from = times[0] ? times[0].min : null;
      const to = times[1] ? times[1].min : null;
      return Object.assign(base, parseWhen(low), { cliente: parseClient(text, low), from, to });
    }
    return Object.assign(base, parseBook(text, low));
  }

  function classify(low) {
    if (/^(ajuda|help|o que voce|o que você|comandos)\b/.test(low)) return "help";
    if (/\b(desmarca|desmarcar|cancela|cancelar|exclui|excluir|remove|remover)\b/.test(low)) return "cancel";
    if (/\b(troca|trocar|muda|mudar|passa|passar)\b/.test(low) && /\b(para|pra)\b/.test(low)) return "move";
    if (/\b(livre|livres|disponivel|disponível|vago|vaga)\b/.test(low)) return "free";
    if (/\b(mostra|mostrar|exibe|ver|agenda de|minha agenda)\b/.test(low) && !/\bagenda\s+\d/.test(low)) return "show";
    if (/\b(agenda|agendar|marca|marcar|coloca|colocar|poe|põe|bota)\b/.test(low)) return "book";
    if (parseClientFromLoose(low) && (extractTimes(low).length || parseDurationHours(low))) return "book";
    return "unknown";
  }

  function periodOf(low) {
    if (/\bmanh[aã]\b/.test(low)) return "manha";
    if (/\btarde\b/.test(low)) return "tarde";
    return "all";
  }

  function parseWhen(low) {
    const today = startOfDay(now());
    const nextWeek = /\bpr[oó]xima\s+semana\b/.test(low);
    const thisWeek = /\b(?:essa|esta)\s+semana\b/.test(low);
    const weekMonday = addDays(mondayOf(today), nextWeek ? 7 : 0);
    const pinWeek = thisWeek || nextWeek;

    if (/\bhoje\b/.test(low)) return { dates: [today], label: "hoje" };
    if (/\bdepois de amanh[aã]\b/.test(low)) return { dates: [addDays(today, 2)] };
    if (/\bamanh[aã]\b/.test(low)) return { dates: [addDays(today, 1)], label: "amanhã" };
    const monthHit = low.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
    if (monthHit) {
      const day = Number(monthHit[1]);
      const mo = MONTHS[stripAccents(monthHit[2]).replace("ç", "c")];
      let y = today.getFullYear();
      let d = new Date(y, mo, day);
      if (d < addDays(today, -1)) d = new Date(y + 1, mo, day);
      return { dates: [d] };
    }
    const iso = low.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (iso) {
      const da = Number(iso[1]);
      const mo = Number(iso[2]) - 1;
      let y = iso[3] ? Number(iso[3]) : today.getFullYear();
      if (y < 100) y += 2000;
      let d = new Date(y, mo, da);
      if (!iso[3] && d < addDays(today, -1)) d = new Date(y + 1, mo, da);
      return { dates: [d] };
    }

    const listed = parseListedDays(low, today);
    if (listed) return listed;

    const numbered = parseDateSpan(low, today);
    if (numbered) return numbered;

    const span = low.match(/\b(?:de\s+)?(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?\s+a(?:té)?\s+(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)/);
    if (span) {
      const a = wdName(span[1]);
      const b = wdName(span[2]);
      if (a != null && b != null) {
        let startDate = pinWeek ? dateOnWeek(weekMonday, a) : nextWeekday(today, a);
        if (startDate < today) startDate = nextWeekday(today, a);
        const monday = mondayOf(startDate);
        const dates = datesInRange(monday, a, b).filter((d) => d >= today);
        return { dates, weekdays: dates.map(weekday) };
      }
    }

    const days = [];
    const seen = new Set();
    for (const [name, wd] of Object.entries(WD)) {
      const re = new RegExp(`\\b${name.replace("-", "[- ]?")}\\b`);
      if (re.test(low) && !seen.has(wd)) {
        seen.add(wd);
        days.push(pinWeek ? dateOnWeek(weekMonday, wd) : nextWeekday(today, wd));
      }
    }
    if (days.length) {
      days.sort((a, b) => a - b);
      return { dates: days, weekdays: [...seen] };
    }
    if (pinWeek) {
      const dates = [1, 2, 3, 4, 5, 6].map((wd) => dateOnWeek(weekMonday, wd));
      return { dates, weekdays: [1, 2, 3, 4, 5, 6] };
    }
    return { dates: [] };
  }

  const WD_ALT = "segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo";

  function resolveCalendarDay(dayNum, wd, from) {
    const base = startOfDay(from);
    for (let monthOffset = 0; monthOffset < 14; monthOffset++) {
      const d = startOfDay(new Date(base.getFullYear(), base.getMonth() + monthOffset, dayNum));
      if (d.getDate() !== dayNum) continue;
      if (d < base) continue;
      if (wd == null || d.getDay() === wd) return d;
    }
    return resolveDayNumber(dayNum, base);
  }

  function parseListedDays(low, today) {
    const re = new RegExp(
      `\\b(${WD_ALT})(?:-feira)?\\s*,?\\s*(?:dia\\s+)?(\\d{1,2})\\b(?![:h])`,
      "gi"
    );
    const hits = [];
    let m;
    while ((m = re.exec(low))) {
      const dayNum = Number(m[2]);
      if (dayNum < 1 || dayNum > 31) continue;
      const wd = wdName(m[1]);
      if (wd == null) continue;
      hits.push({ wd, dayNum, index: m.index, end: m.index + m[0].length });
    }
    if (!hits.length) return null;
    if (hits.length === 2) {
      const between = low.slice(hits[0].end, hits[1].index);
      if (/^\s*a(?:té)?\s*$/i.test(between)) return null;
    }
    const seen = new Set();
    const dates = [];
    for (const h of hits) {
      const d = resolveCalendarDay(h.dayNum, h.wd, today);
      const key = isoDate(d);
      if (seen.has(key)) continue;
      seen.add(key);
      dates.push(d);
    }
    dates.sort((a, b) => a - b);
    return { dates, weekdays: dates.map(weekday) };
  }

  function parseDateSpan(low, today) {
    const re = new RegExp(
      `(?:\\bde\\s+)?(?:(${WD_ALT})(?:-feira)?\\s*,?\\s*)?(?:dia\\s+)?(\\d{1,2})\\s+a(?:té)?\\s+(?:(${WD_ALT})(?:-feira)?\\s*,?\\s*)?(?:dia\\s+)?(\\d{1,2})\\b`,
      "i"
    );
    const m = low.match(re);
    if (!m) return null;
    const hasWd = !!(m[1] || m[3]);
    const hasDia = /\bdia\s+\d{1,2}\b/.test(m[0]);
    if (!hasWd && !hasDia) return null;
    const dayA = Number(m[2]);
    const dayB = Number(m[4]);
    if (dayA < 1 || dayA > 31 || dayB < 1 || dayB > 31) return null;
    const wdA = m[1] ? wdName(m[1]) : null;
    const wdB = m[3] ? wdName(m[3]) : null;
    const start = resolveCalendarDay(dayA, wdA, today);
    let end = resolveCalendarDay(dayB, wdB, start);
    if (end < start) end = resolveCalendarDay(dayB, wdB, addDays(start, 1));
    const dates = [];
    for (let d = start; d <= end; d = addDays(d, 1)) dates.push(startOfDay(d));
    return { dates, weekdays: dates.map(weekday) };
  }

  const NAME_STOP = "segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|hoje|amanhã|amanha|essa|esta|proxima|próxima|semana|das|às|as|de\\s+segunda|na |no |em |1 hora|uma hora";
  const NAME = `([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ']*(?:\\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ']*){0,3}?)(?=\\s+(?:${NAME_STOP})|$)`;

  function parseClient(text, low) {
    const loja = text.match(new RegExp("loja\\s+d[oea]\\s+" + NAME, "i"));
    if (loja) return sanitizeClient("Loja do " + loja[1]);
    const lead = text.match(new RegExp("\\b(?:cliente|pra|para(?:\\s+a|\\s+o)?)\\s+" + NAME, "i"));
    if (lead) {
      const clean = sanitizeClient(lead[1]);
      if (clean) return clean;
    }
    const of = text.match(new RegExp("\\b(?:d[aoe])\\s+" + NAME, "i"));
    if (of) {
      const clean = sanitizeClient(of[1]);
      if (clean) return clean;
    }
    const verb = text.match(new RegExp("\\b(?:coloca(?:r)?|marca(?:r)?|agenda(?:r)?|p[oõ]e|bota)\\s+(?:o\\s+|a\\s+)?" + NAME, "i"));
    if (verb) {
      const clean = sanitizeClient(verb[1]);
      if (clean) return clean;
    }
    return parseClientFromLoose(low);
  }

  function parseClientFromLoose(low) {
    const stop = new Set(["agenda","agendar","marca","marcar","coloca","colocar","desmarca","desmarcar","cancela","cancelar","exclui","excluir","remove","remover","troca","trocar","muda","mudar","poe","põe","bota","pra","para","as","às","das","de","do","da","na","no","em","uma","um","hora","horas","horario","horário","hoje","amanha","amanhã","segunda","terca","terça","quarta","quinta","sexta","sabado","sábado","feira","total","cada","dia","dias","cliente","carro","som","seiko","h","hs","e","o","a","os","i"]);
    const words = low.split(/[^a-zà-ÿ0-9']+/i).filter(Boolean);
    const names = [];
    for (const w of words) {
      if (stop.has(w) || /^\d/.test(w)) continue;
      names.push(w);
    }
    if (!names.length) return null;
    return sanitizeClient(names.slice(0, 3).join(" "));
  }

  function sanitizeClient(s) {
    if (!s) return null;
    let t = s.replace(/\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|feira|hoje|amanhã|amanha|cliente|hora|horas)\b/gi, "").trim();
    t = t.replace(/\s+/g, " ").replace(/^d[oea]\s+/i, "").replace(/\s+d[oea]$/i, "").trim();
    if (t.length < 2) return null;
    return t.replace(/[A-Za-zÀ-ÿ]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  function extractRanges(low) {
    const ranges = [];
    const re = /\b(?:das?\s+)?(\d{1,2}(?::\d{2})?)\s*(?:h|hs)?\s*(?:as|às|ate|até|-|–)\s*(\d{1,2}(?::\d{2})?)/gi;
    let m;
    while ((m = re.exec(low))) {
      const a = parseTimeToken(m[1]);
      const b = parseTimeToken(m[2]);
      if (a == null || b == null || b <= a) continue;
      ranges.push({ inicioMin: a, duracaoMin: clampDur(b - a) });
    }
    return ranges;
  }

  function parseBook(text, low) {
    const when = parseWhen(low);
    const cliente = parseClient(text, low);
    const times = extractTimes(low);
    const ranges = extractRanges(low);
    let inicioMin = null;
    let fimMin = null;
    if (ranges.length) {
      inicioMin = ranges[0].inicioMin;
      fimMin = ranges[0].inicioMin + ranges[0].duracaoMin;
    } else if (times.length >= 2 && /às|as|das/.test(low)) {
      inicioMin = times[0].min;
      fimMin = times[1].min;
    } else if (times.length === 1) {
      inicioMin = times[0].min;
    }

    let duracaoMin = parseDurationHours(low);
    const cada = low.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hs|hora|horas)\s*cada/);
    if (cada) duracaoMin = clampDur(Number(cada[1].replace(",", ".")) * 60);

    let totalH = null;
    const tot = low.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hs|horas?)\s*(?:no total|total)/) || low.match(/agenda\s+(\d+(?:[.,]\d+)?)\s*(?:h|hs|horas?)/);
    if (tot) totalH = Number(tot[1].replace(",", "."));

    const nDays = when.dates.length || 1;
    let durationAssumed = false;
    if (inicioMin != null && fimMin != null && fimMin > inicioMin) {
      duracaoMin = clampDur(fimMin - inicioMin);
    }
    if (!duracaoMin && totalH && nDays) duracaoMin = clampDur((totalH / nDays) * 60);
    if (!duracaoMin && totalH && nDays === 1) duracaoMin = clampDur(totalH * 60);
    if (!duracaoMin && inicioMin != null && fimMin == null) {
      duracaoMin = 60;
      durationAssumed = true;
    }

    if (totalH && duracaoMin && when.dates.length) {
      const per = totalH / when.dates.length;
      if (Math.abs(per * 60 - duracaoMin) > 20 && /2 horas na|1 hora|i hora/.test(low)) {
        /* keep explicit per-day if present */
      }
    }

    const perDay = parsePerDayHours(low, when.dates);
    const blocks = ranges.length
      ? ranges
      : [{ inicioMin, duracaoMin: duracaoMin }];
    const slots = [];
    for (const [i, d] of (when.dates || []).entries()) {
      for (const b of blocks) {
        slots.push({
          data: isoDate(d),
          date: d,
          inicioMin: b.inicioMin,
          duracaoMin: perDay[i] || b.duracaoMin,
        });
      }
    }

    const missing = [];
    if (!cliente) missing.push("cliente");
    if (!when.dates.length) missing.push("dia");
    if (slots.some((s) => s.inicioMin == null)) missing.push("horário");
    if (slots.some((s) => !s.duracaoMin)) missing.push("duração");

    return {
      cliente,
      servico: "Carro de som",
      dates: when.dates,
      weekdays: when.weekdays,
      inicioMin,
      duracaoMin,
      slots,
      missing,
      durationAssumed,
    };
  }

  function parsePerDayHours(low, dates) {
    if (!dates || !dates.length) return [];
    const map = {};
    const re = /(\d+(?:[.,]\d+)?)\s*(?:h|hs|horas?)\s*(?:na|n[oa]|de\s+)?\s*(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado)/g;
    let m;
    while ((m = re.exec(low))) {
      const wd = WD[m[2].replace("terca", "terça").replace("sabado", "sábado")];
      if (wd != null) map[wd] = clampDur(Number(m[1].replace(",", ".")) * 60);
    }
    const iHora = /i hora/.test(low);
    return dates.map((d) => {
      const wd = weekday(d);
      if (map[wd]) return map[wd];
      if (iHora && wd === 5) return 60;
      return null;
    });
  }

  function askMissing(parsed) {
    const q = {
      cliente: "Qual o nome do cliente?",
      dia: "Qual o dia? (ex.: segunda, amanhã, 12/10)",
      horário: "Que horas começa?",
      duração: "Quantas horas em cada dia?",
    };
    return parsed.missing.map((k) => q[k] || k).join(" ");
  }

  async function runCommand(text, extra = {}) {
    const merged = extra.raw || text;
    const parsed = parseIntent(merged);
    if (extra.patch) Object.assign(parsed, extra.patch);
    if (extra.cliente) parsed.cliente = extra.cliente;
    if (extra.inicioMin != null) {
      parsed.inicioMin = extra.inicioMin;
      (parsed.slots || []).forEach((s) => (s.inicioMin = extra.inicioMin));
    }
    if (extra.duracaoMin != null) {
      parsed.duracaoMin = extra.duracaoMin;
      (parsed.slots || []).forEach((s) => {
        if (!s.duracaoMin) s.duracaoMin = extra.duracaoMin;
      });
    }
    if (extra.dates) {
      parsed.dates = extra.dates;
      parsed.slots = extra.dates.map((d) => ({
        data: isoDate(d),
        date: d,
        inicioMin: parsed.inicioMin,
        duracaoMin: parsed.duracaoMin,
      }));
      parsed.missing = parsed.missing.filter((x) => x !== "dia");
    }

    switch (parsed.intent) {
      case "help":
        return say("ok", "Pode falar assim: “Agendar cliente Ana segunda, quarta e sexta às 9h, 1 hora”. Também: mostra agenda, horários livres, desmarca, troca horário.");
      case "unknown":
        return say("bad", "Não entendi. Tenta: agenda, mostra, livres, desmarca ou troca.");
      case "show":
        return doShow(parsed);
      case "free":
        return doFree(parsed);
      case "cancel":
        return doCancel(parsed);
      case "move":
        return doMove(parsed);
      case "book":
        return doBook(parsed);
      default:
        return say("bad", "Não entendi.");
    }
  }

  function say(kind, html) {
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.innerHTML = html;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }
  function sayMe(text) {
    const div = document.createElement("div");
    div.className = "msg me";
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function doShow(parsed) {
    const list = await store.all();
    const dates = parsed.dates.length ? parsed.dates : [startOfDay(now())];
    cursor = dates[0];
    if (dates.length === 1) view = "dia";
    else view = "semana";
    render();
    const chunks = dates.map((d) => describeDay(list, d));
    say("ok", chunks.join("<br><br>"));
  }

  function describeDay(list, d) {
    const iso = isoDate(d);
    if (!isOpenDay(d)) return `<strong>${fmtLong(d)}</strong> — fechado (só seg–sáb).`;
    const items = onDate(list, iso);
    if (!items.length) return `<strong>${fmtLong(d)}</strong> — tudo livre nas janelas.`;
    const rows = items.map((x) => `${minutesToHHMM(x.inicioMin)}–${minutesToHHMM(x.inicioMin + x.duracaoMin)} · ${esc(x.cliente)}`).join("<br>");
    return `<strong>${fmtLong(d)}</strong><br>${rows}`;
  }

  async function doFree(parsed) {
    const list = await store.all();
    const dates = parsed.dates.length ? parsed.dates : [startOfDay(now())];
    cursor = dates[0];
    render();
    const html = dates.map((d) => {
      if (!isOpenDay(d)) return `<strong>${fmtLong(d)}</strong> — fechado.`;
      const wins = windowsOn(d).filter((w) => {
        if (parsed.period === "manha") return w.start < hm("12:00");
        if (parsed.period === "tarde") return w.start >= hm("12:00");
        return true;
      });
      const bits = [];
      for (const w of wins) {
        const busy = onDate(list, isoDate(d));
        let t = w.start;
        while (t < w.end) {
          const hit = busy.find((x) => overlap(t, t + SLOT, x.inicioMin, x.inicioMin + x.duracaoMin));
          if (hit) {
            t = hit.inicioMin + hit.duracaoMin;
            continue;
          }
          let end = t;
          while (end < w.end && !busy.some((x) => overlap(end, end + SLOT, x.inicioMin, x.inicioMin + x.duracaoMin))) {
            end += SLOT;
          }
          bits.push(`${minutesToHHMM(t)}–${minutesToHHMM(end)}`);
          t = end;
        }
      }
      return `<strong>${fmtLong(d)}</strong> — ${bits.length ? bits.join(", ") : "sem vaga nessa faixa"}`;
    }).join("<br>");
    say("ok", html);
  }

  async function doCancel(parsed) {
    const list = await store.all();
    const hits = findHits(list, parsed);
    if (!hits.length) return say("bad", "Não achei esse horário. Diz o cliente e o dia.");
    if (hits.length > 1 && parsed.dates.length !== 1) {
      return confirmList(hits, "Qual desmarcar?", async (item) => {
        item.status = "cancelado";
        await store.put(item);
        render();
        say("ok", `Cancelei ${esc(item.cliente)} em ${fmtLong(fromIso(item.data))} às ${minutesToHHMM(item.inicioMin)}.`);
      });
    }
    for (const item of hits) {
      item.status = "cancelado";
      await store.put(item);
    }
    render();
    say("ok", hits.length > 1
      ? `Cancelei ${hits.length} horários de ${esc(hits[0].cliente)}.`
      : `Cancelei ${esc(hits[0].cliente)} em ${fmtLong(fromIso(hits[0].data))} às ${minutesToHHMM(hits[0].inicioMin)}.`);
  }

  async function doMove(parsed) {
    const list = await store.all();
    if (parsed.to == null) return say("bad", "Pra que horas quer passar?");
    const hits = findHits(list, parsed).filter((x) => parsed.from == null || x.inicioMin === parsed.from);
    if (!hits.length) return say("bad", "Não achei o horário pra trocar.");
    const item = hits[0];
    const dur = item.duracaoMin;
    if (!inWindows(parsed.to, parsed.to + dur)) {
      return say("bad", `Esse horário sai da janela (8:30–11:30 e 14:00–18:00).`);
    }
    const clash = conflicts(list, { data: item.data, inicioMin: parsed.to, duracaoMin: dur, ignoreId: item.id });
    if (clash.length) {
      const s = suggest(list, item.data, dur, parsed.to);
      return say("bad", `Conflito com ${esc(clash[0].cliente)} (${minutesToHHMM(clash[0].inicioMin)}). ${s != null ? "Livre às " + minutesToHHMM(s) + "." : "Sem vaga nesse dia."}`);
    }
    item.inicioMin = parsed.to;
    item.updatedAt = new Date().toISOString();
    await store.put(item);
    render();
    say("ok", `Passei ${esc(item.cliente)} para ${minutesToHHMM(item.inicioMin)} em ${fmtLong(fromIso(item.data))}.`);
  }

  function findHits(list, parsed) {
    let items = active(list);
    if (parsed.cliente) {
      const n = stripAccents(parsed.cliente.toLowerCase());
      items = items.filter((x) => {
        const c = stripAccents(x.cliente.toLowerCase());
        return c.includes(n) || n.includes(c) || n.split(/\s+/).some((w) => w.length > 2 && c.includes(w));
      });
    }
    if (parsed.dates && parsed.dates.length) {
      const set = new Set(parsed.dates.map(isoDate));
      items = items.filter((x) => set.has(x.data));
    }
    if (parsed.inicioMin != null) items = items.filter((x) => x.inicioMin === parsed.inicioMin);
    return items.sort((a, b) => a.data.localeCompare(b.data) || a.inicioMin - b.inicioMin);
  }

  function confirmList(items, title, onPick) {
    const el = say("ok", `${esc(title)}<menu></menu>`);
    const menu = el.querySelector("menu");
    for (const item of items.slice(0, 8)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = `${item.cliente} · ${fmtLong(fromIso(item.data))} ${minutesToHHMM(item.inicioMin)}`;
      b.onclick = () => onPick(item);
      menu.appendChild(b);
    }
  }

  async function doBook(parsed) {
    if (parsed.missing.includes("cliente")) {
      pending = { kind: "need", field: "cliente", parsed };
      return say("ok", askMissing(parsed));
    }
    if (parsed.missing.includes("dia")) {
      pending = { kind: "need", field: "dia", parsed };
      return say("ok", askMissing(parsed));
    }
    if (parsed.missing.includes("horário")) {
      pending = { kind: "need", field: "horário", parsed };
      return say("ok", askMissing(parsed));
    }
    if (parsed.missing.includes("duração")) {
      pending = { kind: "need", field: "duração", parsed };
      return say("ok", askMissing(parsed));
    }

    const list = await store.all();
    const serieId = parsed.slots.length > 1 ? uid() : null;
    const { blocked, already, ok } = splitSlots(list, parsed);

    if (!ok.length && !already.length) {
      return say("bad", "Não marquei nada.<br>" + blocked.map((b) => b.reason).join("<br>"));
    }
    if (ok.length) await saveSlots(ok, parsed, serieId);
    if (parsed.slots[0]) {
      cursor = parsed.slots[0].date;
      view = parsed.slots.length > 1 ? "semana" : view;
      render();
    }
    const parts = [];
    if (ok.length) parts.push(resumeSave(ok, parsed));
    if (already.length) {
      const lines = already.map((s) => `${fmtLong(fromIso(s.data))} · ${minutesToHHMM(s.inicioMin)}–${minutesToHHMM(s.inicioMin + s.duracaoMin)}`);
      parts.push(`Já estava com <strong>${esc(parsed.cliente)}</strong> nesse horário:<br>${lines.join("<br>")}`);
    }
    if (blocked.length) parts.push("Não sobrescrevi:<br>" + blocked.map((b) => b.reason).join("<br>"));
    say(blocked.length ? "bad" : "ok", parts.join("<br><br>"));
  }

  function splitSlots(list, parsed) {
    const blocked = [];
    const already = [];
    const ok = [];
    for (const s of parsed.slots) {
      const day = fromIso(s.data);
      const faixa = `${minutesToHHMM(s.inicioMin)}–${minutesToHHMM(s.inicioMin + s.duracaoMin)}`;
      if (day < startOfDay(now())) {
        blocked.push({ s, reason: `${fmtLong(day)} já passou.` });
        continue;
      }
      if (!isOpenDay(day)) {
        blocked.push({ s, reason: `${fmtLong(day)} é domingo — carro não roda.` });
        continue;
      }
      if (s.inicioMin == null || !s.duracaoMin) continue;
      if (!inWindows(s.inicioMin, s.inicioMin + s.duracaoMin)) {
        blocked.push({
          s,
          reason: `${fmtLong(day)} ${faixa} sai da janela (8:30–11:30 / 14:00–18:00). ${formatFree(list, s.data, s.duracaoMin)}`,
        });
        continue;
      }
      const clash = conflicts(list, s);
      if (clash.length) {
        const identical = clash.every((c) => sameClient(c.cliente, parsed.cliente) && c.inicioMin === s.inicioMin && c.duracaoMin === s.duracaoMin);
        if (identical) {
          already.push(s);
          continue;
        }
        const c = clash[0];
        blocked.push({
          s,
          reason: `${fmtLong(day)} ${faixa} já está com ${esc(c.cliente)} (${minutesToHHMM(c.inicioMin)}–${minutesToHHMM(c.inicioMin + c.duracaoMin)}). ${formatFree(list, s.data, s.duracaoMin)}`,
          owner: c.cliente,
        });
        continue;
      }
      ok.push(s);
    }
    return { blocked, already, ok };
  }

  async function saveSlots(slots, parsed, serieId) {
    const nowIso = new Date().toISOString();
    for (const s of slots) {
      await store.put({
        id: uid(),
        serieId,
        cliente: parsed.cliente,
        servico: parsed.servico || "Carro de som",
        data: s.data,
        inicioMin: s.inicioMin,
        duracaoMin: s.duracaoMin,
        observacoes: parsed.observacoes || "",
        desconto: 0,
        descontoHora: 0,
        pago: false,
        status: "ativo",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    cursor = slots[0].date;
    render();
  }

  function resumeSave(slots, parsed) {
    const lines = slots.map((s) => `${fmtLong(fromIso(s.data))} · ${minutesToHHMM(s.inicioMin)}–${minutesToHHMM(s.inicioMin + s.duracaoMin)}`);
    const note = parsed.durationAssumed ? "<br>Contei 1 hora — a frase não disse o fim." : "";
    return `Marcado: <strong>${esc(parsed.cliente)}</strong><br>${lines.join("<br>")}${note}`;
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function continuePending(text) {
    if (!pending) return false;
    const p = pending;
    pending = null;
    if (p.kind !== "need") return false;
    if (p.field === "cliente") {
      p.parsed.cliente = sanitizeClient(text) || text.trim();
      p.parsed.missing = p.parsed.missing.filter((x) => x !== "cliente");
      return runCommand(p.parsed.raw, { patch: p.parsed });
    }
    if (p.field === "dia") {
      const w = parseWhen(text.toLowerCase());
      if (!w.dates.length) {
        pending = p;
        return say("ok", "Não peguei o dia. Ex.: sexta, amanhã, 12/10.");
      }
      return runCommand(p.parsed.raw, { patch: p.parsed, dates: w.dates });
    }
    if (p.field === "horário") {
      const t = extractTimes(text.toLowerCase())[0] || (parseTimeToken(text.trim()) != null ? { min: parseTimeToken(text.trim()) } : null);
      if (!t) {
        pending = p;
        return say("ok", "Que horas? Ex.: 9h ou 15:00.");
      }
      return runCommand(p.parsed.raw, { patch: p.parsed, inicioMin: t.min });
    }
    if (p.field === "duração") {
      const d = parseDurationHours(text) || (() => {
        const n = Number(text.replace(",", ".").replace(/[^\d.]/g, ""));
        return Number.isFinite(n) && n > 0 ? clampDur(n * 60) : null;
      })();
      if (!d) {
        pending = p;
        return say("ok", "Quantas horas? Ex.: 1 hora.");
      }
      return runCommand(p.parsed.raw, { patch: p.parsed, duracaoMin: d });
    }
    return false;
  }

  async function render() {
    const list = await store.all();
    if (view === "dia") renderDay(list);
    else if (view === "semana") renderWeek(list);
    else renderMonth(list);
    document.querySelectorAll(".views button").forEach((b) => {
      if (b.dataset.view) b.classList.toggle("is-on", b.dataset.view === view);
    });
    renderDash(list);
  }

  function dashBounds() {
    const today = startOfDay(now());
    if (dashRange === "hoje") return { from: isoDate(today), to: isoDate(today), label: "Hoje" };
    if (dashRange === "semana") {
      const mon = mondayOf(today);
      const sat = addDays(mon, 5);
      return { from: isoDate(mon), to: isoDate(sat), label: "Esta semana" };
    }
    if (dashRange === "mes") {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: isoDate(from), to: isoDate(to), label: "Este mês" };
    }
    const fromEl = $("dashFrom");
    const toEl = $("dashTo");
    let from = fromEl && fromEl.value ? fromEl.value : isoDate(today);
    let to = toEl && toEl.value ? toEl.value : isoDate(today);
    if (from > to) [from, to] = [to, from];
    return { from, to, label: "Período" };
  }
  function inPeriod(iso, from, to) {
    return iso >= from && iso <= to;
  }
  function fmtIso(iso) {
    const d = fromIso(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function payBadge(estado, title) {
    if (estado === "pago") return `<span class="pay is-on" aria-label="Pago">Pago</span>`;
    if (estado === "parcial") {
      return `<span class="pay is-part" aria-label="Parcial"${title ? ` title="${esc(title)}"` : ""}>Parcial</span>`;
    }
    return `<span class="pay is-off" aria-label="Pendente">Pendente</span>`;
  }
  function discountsFor(cliente, from, to) {
    const key = clientKey(cliente);
    return discounts
      .filter((p) => clientKey(p.cliente) === key && inPeriod(p.data, from, to))
      .sort((a, b) => a.data.localeCompare(b.data) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  function paymentsFor(cliente, from, to) {
    const key = clientKey(cliente);
    return payments
      .filter((p) => clientKey(p.cliente) === key && inPeriod(p.data, from, to))
      .sort((a, b) => a.data.localeCompare(b.data) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  function clientKey(name) {
    return stripAccents(String(name || "").toLowerCase()).trim();
  }

  function renderDash(list) {
    const { from, to, label } = dashBounds();
    const span = $("dashSpan");
    if (span) span.textContent = `${label} · ${fmtIso(from)} – ${fmtIso(to)} · ${money(settings.valorHora)}/h`;
    const hint = $("rateHint");
    if (hint) hint.textContent = money(settings.valorHora) + "/h";

    const jobs = active(list)
      .filter((x) => inPeriod(x.data, from, to))
      .sort((a, b) => a.data.localeCompare(b.data) || a.inicioMin - b.inicioMin);

    const byClient = new Map();
    for (const x of jobs) {
      const k = clientKey(x.cliente);
      if (!byClient.has(k)) byClient.set(k, { cliente: x.cliente, jobs: [] });
      byClient.get(k).jobs.push(x);
    }

    const totals = jobs.reduce(
      (acc, x) => {
        const f = figures(x);
        acc.min += x.duracaoMin;
        acc.bruto += f.bruto;
        acc.desconto += f.desconto;
        acc.total += f.total;
        acc.ids.add(clientKey(x.cliente));
        return acc;
      },
      { min: 0, bruto: 0, desconto: 0, total: 0, recebido: 0, pendente: 0, ids: new Set() }
    );
    totals.desconto = 0;
    totals.total = 0;
    for (const pack of byClient.values()) {
      const s = clientBalance(pack.jobs, from, to);
      totals.desconto += s.desconto;
      totals.total += s.total;
      totals.recebido += s.pago;
      totals.pendente += s.pendente;
    }
    totals.recebido = round2(totals.recebido);
    totals.pendente = round2(totals.pendente);
    totals.bruto = round2(totals.bruto);
    totals.desconto = round2(totals.desconto);
    totals.total = round2(totals.total);

    const kpis = $("dashKpis");
    if (kpis) {
      const cells = [
        [fmtHours(totals.min), "Horas trabalhadas"],
        [money(totals.bruto), "Valor bruto"],
        [money(totals.desconto), "Descontos"],
        [money(totals.total), "Total final"],
        [money(totals.recebido), "Recebido", "is-in"],
        [money(totals.pendente), "Pendente", "is-out"],
        [String(totals.ids.size), "Clientes atendidos"],
        [String(jobs.length), "Quantidade de serviços"],
      ];
      kpis.innerHTML = cells
        .map(
          ([v, l, cls]) =>
            `<div class="kpi${cls ? " " + cls : ""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`
        )
        .join("");
    }

    const clientBody = $("dashClients") && $("dashClients").tBodies[0];
    if (clientBody) {
      const rows = [...byClient.values()].sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
      clientBody.innerHTML = rows.length
        ? rows
            .map((r) => {
              const s = clientBalance(r.jobs, from, to);
              const pendenteTxt = s.credito > 0 ? "Crédito " + money(s.credito) : money(s.pendente);
              const horaTxt = s.horaFica == null ? "—" : money(s.horaFica);
              return `<tr data-key="${esc(clientKey(r.cliente))}">
                <td data-label="Cliente">${esc(r.cliente)}</td>
                <td class="num" data-label="Horas">${esc(fmtHours(s.min))}</td>
                <td class="num" data-label="Desc./h"><input class="mini" data-desc-hora inputmode="decimal" value="${esc(moneyInput(s.descHora))}" placeholder="0" aria-label="Desconto por hora de ${esc(r.cliente)}"></td>
                <td class="num" data-label="Hora fica">${esc(horaTxt)}</td>
                <td class="num" data-label="Desconto">${esc(money(s.desconto))}</td>
                <td class="num" data-label="Total">${esc(money(s.total))}</td>
                <td class="num" data-label="Pago"><input class="mini" data-pago inputmode="decimal" value="${esc(moneyInput(s.adiantado))}" placeholder="0" aria-label="Pagamento parcial de ${esc(r.cliente)}"></td>
                <td class="num${s.credito > 0 ? " is-credit" : ""}" data-label="Pendente">${esc(pendenteTxt)}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td class="empty" colspan="8">Nenhum serviço neste período.</td></tr>`;
      clientBody.querySelectorAll("tr[data-key]").forEach((tr) => {
        const pack = byClient.get(tr.dataset.key);
        if (!pack) return;
        tr.cells[0].onclick = () => {
          histCliente = pack.cliente;
          const sel = $("histCliente");
          if (sel) sel.value = histCliente;
          renderDashFromStore();
        };
        const descInput = tr.querySelector("[data-desc-hora]");
        if (descInput) {
          descInput.addEventListener("click", (e) => e.stopPropagation());
          descInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              descInput.blur();
            }
          });
          descInput.addEventListener("change", () => applyHourDiscount(pack.cliente, descInput.value));
        }
        const pagoInput = tr.querySelector("[data-pago]");
        if (pagoInput) {
          pagoInput.addEventListener("click", (e) => e.stopPropagation());
          pagoInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pagoInput.blur();
            }
          });
          pagoInput.addEventListener("change", () => applyPartialPayment(pack.cliente, from, to, pagoInput.value));
        }
      });
    }

    const names = [...new Set(active(list).map((x) => x.cliente))].sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );
    const sel = $("histCliente");
    if (sel) {
      const current = histCliente;
      sel.innerHTML =
        `<option value="">Todos</option>` +
        names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
      if (current && names.includes(current)) sel.value = current;
      else {
        sel.value = "";
        histCliente = "";
      }
    }

    const cover = jobCover(jobs, from, to);
    const hist = jobs.filter((x) => {
      if (histCliente && !sameClient(x.cliente, histCliente)) return false;
      const estado = (cover.get(x.id) || {}).estado || "pendente";
      if (histPago === "pago" && estado !== "pago") return false;
      if (histPago === "pendente" && estado === "pago") return false;
      return true;
    });
    const histBody = $("dashHist") && $("dashHist").tBodies[0];
    if (histBody) {
      histBody.innerHTML = hist.length
        ? hist
            .map((x) => {
              const f = figures(x);
              const c = cover.get(x.id) || { estado: "pendente", coberto: 0, total: f.total };
              const title = c.estado === "parcial" ? `Entrou ${money(c.coberto)} de ${money(c.total)}` : "";
              return `<tr data-id="${esc(x.id)}">
                <td data-label="Data">${esc(fmtIso(x.data))}</td>
                <td data-label="Cliente">${esc(x.cliente)}</td>
                <td data-label="Horário">${esc(minutesToHHMM(x.inicioMin))}–${esc(minutesToHHMM(x.inicioMin + x.duracaoMin))}</td>
                <td class="num" data-label="Horas">${esc(fmtHours(x.duracaoMin))}</td>
                <td class="num" data-label="Bruto">${esc(money(f.bruto))}</td>
                <td class="num" data-label="Desconto">${esc(money(f.desconto))}</td>
                <td class="num" data-label="Total">${esc(money(f.total))}</td>
                <td data-label="Status">${payBadge(c.estado, title)}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td class="empty" colspan="7">Nenhum serviço neste filtro.</td></tr>`;
      histBody.querySelectorAll("tr[data-id]").forEach((tr) => {
        tr.onclick = async () => {
          const all = await store.all();
          const item = all.find((x) => x.id === tr.dataset.id);
          if (item) openEdit(item);
        };
      });
    }
    paintPayDialog(jobs, false);
  }

  function sharedHourDiscount(items) {
    const rates = new Set(items.map((x) => round2(x.descontoHora || 0)).filter((n) => n > 0));
    if (rates.size !== 1) return 0;
    return [...rates][0];
  }
  function moneyInput(n) {
    if (!(Number(n) > 0)) return "";
    return String(round2(n)).replace(".", ",");
  }
  function clientBalance(items, from, to) {
    const acc = { min: 0, bruto: 0, desconto: 0, total: 0, legado: 0 };
    const rates = new Set();
    for (const x of items) {
      const f = figures(x);
      acc.min += x.duracaoMin;
      acc.bruto += f.bruto;
      acc.desconto += f.desconto;
      acc.total += f.total;
      if (x.pago) acc.legado += f.total;
      let porHora = Math.max(0, Number(x.descontoHora) || 0);
      if (porHora > settings.valorHora) porHora = 0;
      rates.add(round2(porHora));
    }
    const descHora = rates.size === 1 ? [...rates][0] : null;
    const horaFica = descHora == null ? null : round2(Math.max(0, settings.valorHora - descHora));
    const adiantado = items.length
      ? paymentsFor(items[0].cliente, from, to).reduce((s, p) => s + p.valor, 0)
      : 0;
    const pago = round2(acc.legado + adiantado);
    const total = round2(acc.total);
    const saldo = round2(total - pago);
    return {
      min: acc.min,
      bruto: round2(acc.bruto),
      desconto: round2(acc.desconto),
      total,
      descHora,
      horaFica,
      adiantado: round2(adiantado),
      pago,
      pendente: saldo > 0 ? saldo : 0,
      credito: saldo < 0 ? round2(-saldo) : 0,
    };
  }
  async function foldSharedHourDiscount(list, from, to) {
    const groups = new Map();
    for (const x of active(list)) {
      const k = clientKey(x.cliente);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    let changed = false;
    for (const items of groups.values()) {
      const valor = sharedHourDiscount(items);
      if (!(valor > 0)) continue;
      const cliente = items[0].cliente;
      if (!discountsFor(cliente, from, to).length) {
        const today = isoDate(startOfDay(now()));
        discounts.push({
          id: uid(),
          cliente,
          data: today >= from && today <= to ? today : from,
          valor,
          createdAt: new Date().toISOString(),
        });
        changed = true;
      }
      const nowIso = new Date().toISOString();
      for (const item of items) {
        if (!(item.descontoHora > 0)) continue;
        item.descontoHora = 0;
        item.updatedAt = nowIso;
        await store.put(item);
        changed = true;
      }
    }
    if (changed) persistDiscounts();
    return changed;
  }
  function jobCover(jobs, from, to) {
    const map = new Map();
    const groups = new Map();
    for (const x of jobs) {
      const k = clientKey(x.cliente);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    for (const items of groups.values()) {
      let pool = paymentsFor(items[0].cliente, from, to).reduce((s, p) => s + p.valor, 0);
      const ordered = [...items].sort((a, b) => a.data.localeCompare(b.data) || a.inicioMin - b.inicioMin);
      for (const x of ordered) {
        const total = figures(x).total;
        let coberto = 0;
        if (x.pago || total <= 0) coberto = total;
        else {
          coberto = round2(Math.min(total, pool));
          pool = round2(Math.max(0, pool - coberto));
        }
        let estado = "pendente";
        if (coberto >= total - 0.001) estado = "pago";
        else if (coberto > 0) estado = "parcial";
        map.set(x.id, { total, coberto, estado });
      }
    }
    return map;
  }
  function parseMoneyInput(v) {
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }
  async function applyHourDiscount(cliente, raw) {
    let n = parseMoneyInput(raw);
    if (n > settings.valorHora) n = round2(settings.valorHora);
    const nowIso = new Date().toISOString();
    const key = clientKey(cliente);
    const all = await store.all();
    for (const item of all) {
      if (item.status !== "ativo" || clientKey(item.cliente) !== key) continue;
      if (round2(item.descontoHora || 0) === n && !(Number(item.descontoHora) > settings.valorHora)) continue;
      item.descontoHora = n;
      item.updatedAt = nowIso;
      await store.put(item);
    }
    render();
  }
  function applyPartialPayment(cliente, from, to, raw) {
    const valor = parseMoneyInput(raw);
    const key = clientKey(cliente);
    payments = payments.filter((p) => !(clientKey(p.cliente) === key && inPeriod(p.data, from, to)));
    if (valor > 0) {
      const today = isoDate(startOfDay(now()));
      payments.push({
        id: uid(),
        cliente,
        data: today >= from && today <= to ? today : from,
        valor,
        createdAt: new Date().toISOString(),
      });
    }
    persistPayments();
    render();
  }
  function openPayDialog(cliente, jobs) {
    payTarget = { key: clientKey(cliente), cliente };
    const form = $("payForm");
    if (form) form.valor.value = "";
    const err = $("payErr");
    if (err) err.hidden = true;
    paintPayDialog(jobs, true);
    const dlg = $("payDlg");
    if (dlg && !dlg.open) dlg.showModal();
    if (form) form.valor.focus();
  }
  function paintPayDialog(jobs, resetDate) {
    const dlg = $("payDlg");
    if (!dlg || !dlg.open && !resetDate) return;
    if (!payTarget) return;
    const { from, to, label } = dashBounds();
    const mine = (jobs || []).filter((x) => clientKey(x.cliente) === payTarget.key && inPeriod(x.data, from, to));
    if (dlg.open && !mine.length) {
      dlg.close();
      payTarget = null;
      return;
    }
    const bal = clientBalance(mine, from, to);
    payTarget.total = bal.total;
    payTarget.pago = bal.pago;
    const title = $("payTitle");
    if (title) title.textContent = "Receber — " + payTarget.cliente;
    const summary = $("paySummary");
    if (summary) {
      const saldoTxt = bal.credito > 0 ? "Crédito " + money(bal.credito) : "Pendente " + money(bal.pendente);
      summary.textContent = `${label} · ${fmtIso(from)} – ${fmtIso(to)} · ${fmtHours(bal.min)} · Total ${money(bal.total)} · Pago ${money(bal.pago)} · ${saldoTxt}`;
    }
    const form = $("payForm");
    if (form && resetDate) {
      const today = isoDate(startOfDay(now()));
      form.data.value = today >= from && today <= to ? today : from;
    }
    const list = $("payList");
    const rows = paymentsFor(payTarget.cliente, from, to);
    if (list) {
      list.innerHTML = rows.length
        ? rows
            .map(
              (p) =>
                `<li><span>${esc(fmtIso(p.data))} · ${esc(money(p.valor))}</span><button type="button" class="ghost" data-drop-pay="${esc(p.id)}">Remover</button></li>`
            )
            .join("")
        : `<li class="empty">Nenhum valor neste período.</li>`;
    }
    refreshPayPreview();
  }
  function refreshPayPreview() {
    const preview = $("payPreview");
    const form = $("payForm");
    if (!preview || !form || !payTarget) return;
    const extra = parseMoneyInput(form.valor.value);
    if (!(extra > 0)) {
      preview.textContent = "O valor entra na data escolhida, dentro do período aberto no dashboard.";
      return;
    }
    const saldo = round2((payTarget.total || 0) - (payTarget.pago || 0) - extra);
    if (saldo > 0) preview.textContent = `Depois deste valor, o pendente fica ${money(saldo)}.`;
    else if (saldo < 0) preview.textContent = `Depois deste valor, fica um crédito de ${money(-saldo)} para as próximas horas deste período.`;
    else preview.textContent = "Depois deste valor, o período fica quitado.";
  }
  function openDiscDialog(cliente, jobs) {
    discTarget = { key: clientKey(cliente), cliente };
    const form = $("discForm");
    if (form) form.valor.value = "";
    const err = $("discErr");
    if (err) err.hidden = true;
    paintDiscDialog(jobs, true);
    const dlg = $("discDlg");
    if (dlg && !dlg.open) dlg.showModal();
    if (form) form.valor.focus();
  }
  function paintDiscDialog(jobs, resetDate) {
    const dlg = $("discDlg");
    if (!dlg || (!dlg.open && !resetDate)) return;
    if (!discTarget) return;
    const { from, to, label } = dashBounds();
    const mine = (jobs || []).filter((x) => clientKey(x.cliente) === discTarget.key && inPeriod(x.data, from, to));
    if (dlg.open && !mine.length) {
      dlg.close();
      discTarget = null;
      return;
    }
    const bal = clientBalance(mine, from, to);
    discTarget.bruto = bal.bruto;
    discTarget.desconto = bal.desconto;
    discTarget.total = bal.total;
    discTarget.pago = bal.pago;
    discTarget.pendente = bal.pendente;
    const title = $("discTitle");
    if (title) title.textContent = "Desconto — " + discTarget.cliente;
    const summary = $("discSummary");
    if (summary) {
      summary.textContent = `${label} · ${fmtIso(from)} – ${fmtIso(to)} · ${fmtHours(bal.min)} · Horas ${money(bal.bruto)} · Desconto ${money(bal.desconto)} · Total ${money(bal.total)} · Pendente ${money(bal.pendente)}`;
    }
    const form = $("discForm");
    if (form && resetDate) {
      const today = isoDate(startOfDay(now()));
      form.data.value = today >= from && today <= to ? today : from;
    }
    const list = $("discList");
    const rows = discountsFor(discTarget.cliente, from, to);
    if (list) {
      list.innerHTML = rows.length
        ? rows
            .map(
              (p) =>
                `<li><span>${esc(fmtIso(p.data))} · ${esc(money(p.valor))}</span><button type="button" class="ghost" data-drop-disc="${esc(p.id)}">Remover</button></li>`
            )
            .join("")
        : `<li class="empty">Nenhum desconto neste período.</li>`;
    }
    refreshDiscPreview();
  }
  function refreshDiscPreview() {
    const preview = $("discPreview");
    const form = $("discForm");
    if (!preview || !form || !discTarget) return;
    const extra = parseMoneyInput(form.valor.value);
    if (!(extra > 0)) {
      preview.textContent = "Esse valor sai uma vez do total do período. Não multiplica pelas horas.";
      return;
    }
    const room = round2(Math.max(0, (discTarget.bruto || 0) - (discTarget.desconto || 0)));
    const aplicado = Math.min(extra, room);
    const saldo = round2((discTarget.total || 0) - aplicado - (discTarget.pago || 0));
    if (!(room > 0)) {
      preview.textContent = "Não há mais valor para descontar neste período.";
      return;
    }
    if (extra > room) preview.textContent = `O desconto não passa de ${money(room)}. O pendente fica ${money(Math.max(0, saldo))}.`;
    else if (saldo > 0) preview.textContent = `Depois deste desconto, o pendente fica ${money(saldo)}.`;
    else if (saldo < 0) preview.textContent = `Depois deste desconto, fica um crédito de ${money(-saldo)}.`;
    else preview.textContent = "Depois deste desconto, o pendente fica R$ 0,00.";
  }
  async function renderDashFromStore() {
    renderDash(await store.all());
  }

  function renderDay(list) {
    periodTitle.textContent = fmtLong(cursor);
    const iso = isoDate(cursor);
    const wrap = document.createElement("div");
    wrap.className = "day-log";
    if (!isOpenDay(cursor)) {
      wrap.innerHTML = `<div class="slot is-closed">Domingo — carro parado.</div>`;
      calendarEl.replaceChildren(wrap);
      return;
    }
    const items = onDate(list, iso);
    let last = null;
    for (const t of slotsOfDay()) {
      if (last != null && t > last + SLOT) {
        const closed = document.createElement("div");
        closed.className = "slot is-closed";
        closed.textContent = "Almoço · 11:30–14:00";
        wrap.appendChild(closed);
      }
      last = t;
      const hit = items.find((x) => t >= x.inicioMin && t < x.inicioMin + x.duracaoMin);
      const row = document.createElement("div");
      row.className = "slot " + (hit ? "is-busy" : "is-free");
      const time = document.createElement("time");
      time.textContent = minutesToHHMM(t);
      const bar = document.createElement("div");
      bar.className = "bar";
      if (hit && t === hit.inicioMin) {
        bar.style.background = colorFor(hit.cliente);
        bar.innerHTML = `<span class="who">${esc(hit.cliente)}</span> <span class="meta">${minutesToHHMM(hit.inicioMin)}–${minutesToHHMM(hit.inicioMin + hit.duracaoMin)} · ${hit.duracaoMin / 60}h</span>`;
        bar.onclick = () => openEdit(hit);
      } else if (hit) {
        bar.style.background = colorFor(hit.cliente);
        bar.style.opacity = ".85";
      } else {
        bar.textContent = "livre";
        bar.onclick = () => quickBook(iso, t);
      }
      row.append(time, bar);
      wrap.appendChild(row);
    }
    const end = document.createElement("div");
    end.className = "slot is-closed is-end";
    end.innerHTML = `<time>18:00</time><div>fim do expediente</div>`;
    wrap.appendChild(end);
    calendarEl.replaceChildren(wrap);
  }

  function renderWeek(list) {
    const start = addDays(cursor, cursor.getDay() === 0 ? 1 : 1 - cursor.getDay());
    const end = addDays(start, 5);
    periodTitle.textContent = `${pad(start.getDate())}/${pad(start.getMonth() + 1)} – ${pad(end.getDate())}/${pad(end.getMonth() + 1)}`;
    const grid = document.createElement("div");
    grid.className = "week";
    const todayIso = isoDate(startOfDay(now()));
    for (let i = 0; i < 6; i++) {
      const d = addDays(start, i);
      const iso = isoDate(d);
      const col = document.createElement("div");
      col.className = "week-col" + (iso === todayIso ? " today" : "");
      const h = document.createElement("header");
      h.textContent = `${WEEKDAYS_SHORT[weekday(d)]} ${d.getDate()}`;
      h.onclick = () => {
        cursor = d;
        view = "dia";
        render();
      };
      col.appendChild(h);
      const items = onDate(list, iso);
      const used = new Set();
      let last = null;
      for (const t of slotsOfDay()) {
        if (last != null && t > last + SLOT) {
          const br = document.createElement("div");
          br.className = "mini-slot break";
          br.textContent = "11:30–14:00";
          col.appendChild(br);
        }
        last = t;
        const hit = items.find((x) => t >= x.inicioMin && t < x.inicioMin + x.duracaoMin);
        if (hit) {
          if (used.has(hit.id)) continue;
          used.add(hit.id);
          const el = document.createElement("div");
          el.className = "mini-slot busy";
          el.style.background = colorFor(hit.cliente);
          el.textContent = `${minutesToHHMM(hit.inicioMin)} ${hit.cliente}`;
          el.onclick = () => openEdit(hit);
          col.appendChild(el);
        } else {
          const el = document.createElement("div");
          el.className = "mini-slot";
          el.textContent = minutesToHHMM(t);
          el.onclick = () => quickBook(iso, t);
          col.appendChild(el);
        }
      }
      const end = document.createElement("div");
      end.className = "mini-slot end";
      end.textContent = "18:00";
      col.appendChild(end);
      if (!used.size) col.classList.add("is-empty");
      grid.appendChild(col);
    }
    calendarEl.replaceChildren(grid);
  }

  function renderMonth(list) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    periodTitle.textContent = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const first = new Date(y, m, 1);
    const start = addDays(first, -first.getDay());
    const grid = document.createElement("div");
    grid.className = "month";
    WEEKDAYS_SHORT.forEach((n) => {
      const d = document.createElement("div");
      d.className = "dow";
      d.textContent = n;
      grid.appendChild(d);
    });
    const todayIso = isoDate(startOfDay(now()));
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const iso = isoDate(d);
      const cell = document.createElement("div");
      cell.className = "mday";
      if (d.getMonth() !== m) cell.classList.add("off");
      if (!isOpenDay(d)) cell.classList.add("closed");
      if (iso === todayIso) cell.classList.add("today");
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = d.getDate();
      const ticks = document.createElement("div");
      ticks.className = "ticks";
      onDate(list, iso).slice(0, 3).forEach((x) => {
        const t = document.createElement("div");
        t.className = "tick";
        t.style.background = colorFor(x.cliente);
        t.textContent = `${minutesToHHMM(x.inicioMin)} ${x.cliente}`;
        ticks.appendChild(t);
      });
      cell.append(n, ticks);
      cell.onclick = () => {
        if (!isOpenDay(d)) return;
        cursor = d;
        view = "dia";
        render();
      };
      grid.appendChild(cell);
    }
    calendarEl.replaceChildren(grid);
  }

  function fillDurSelect(sel, current) {
    sel.innerHTML = "";
    for (let m = 30; m <= 240; m += 30) {
      const o = document.createElement("option");
      o.value = String(m);
      o.textContent = m % 60 === 0 ? m / 60 + " h" : m / 60 + " h";
      if (m === 30) o.textContent = "30 min";
      else if (m === 90) o.textContent = "1,5 h";
      else if (m % 60) o.textContent = (m / 60).toString().replace(".", ",") + " h";
      if (m === current) o.selected = true;
      sel.appendChild(o);
    }
  }

  let editing = null;
  function setPagoBtn(on) {
    pagoEditing = !!on;
    const b = $("pagoBtn");
    if (!b) return;
    b.classList.toggle("is-on", pagoEditing);
    b.classList.toggle("is-off", !pagoEditing);
    b.setAttribute("aria-pressed", pagoEditing ? "true" : "false");
    b.textContent = pagoEditing ? "Pago" : "Pendente";
  }
  function refreshEditTotal() {
    if (!editing) return;
    const dur = Number(editForm.duracaoMin.value) || editing.duracaoMin;
    const desc = Number(editForm.desconto.value) || 0;
    const descH = Number(editForm.descontoHora.value) || 0;
    const f = figures({ duracaoMin: dur, desconto: desc, descontoHora: descH, pago: pagoEditing });
    const el = $("editTotal");
    if (el) {
      el.textContent = `${fmtHours(dur)} × ${money(settings.valorHora)} = ${money(f.bruto)} · neste horário ${money(
        Math.max(0, desc)
      )} · desc./h ${money(Math.max(0, descH))} · total ${money(f.total)}`;
    }
  }
  function openEdit(item) {
    editing = withFinance(item);
    editForm.cliente.value = item.cliente;
    editForm.servico.value = item.servico || "Carro de som";
    editForm.data.value = item.data;
    editForm.inicio.value = minutesToHHMM(item.inicioMin);
    fillDurSelect(editForm.duracaoMin, item.duracaoMin);
    editForm.observacoes.value = item.observacoes || "";
    editForm.desconto.value = editing.desconto ? String(editing.desconto) : "0";
    if (editForm.descontoHora) editForm.descontoHora.value = editing.descontoHora ? String(editing.descontoHora) : "0";
    setPagoBtn(editing.pago);
    refreshEditTotal();
    editErr.hidden = true;
    serieHint.hidden = !item.serieId;
    serieHint.textContent = item.serieId ? "Este horário faz parte de uma série (ex.: seg/qua/sex). A edição vale só neste dia." : "";
    $("editTitle").textContent = item.cliente;
    dlg.showModal();
  }

  function quickBook(iso, t) {
    cmd.value = `Agenda 1 hora pra  em ${iso.split("-").reverse().join("/")} às ${minutesToHHMM(t)}`;
    cmd.focus();
    const pos = "Agenda 1 hora pra ".length;
    cmd.setSelectionRange(pos, pos);
    document.querySelector('.tab[data-panel="comandos"]').click();
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = e.submitter ? e.submitter.value : "fechar";
    if (!editing) {
      dlg.close();
      return;
    }
    if (v === "fechar") {
      dlg.close();
      return;
    }
    if (v === "excluir") {
      await store.del(editing.id);
      dlg.close();
      render();
      say("ok", `Excluí o horário de ${esc(editing.cliente)}.`);
      return;
    }
    if (v === "cancelar") {
      editing.status = "cancelado";
      editing.updatedAt = new Date().toISOString();
      await store.put(editing);
      dlg.close();
      render();
      say("ok", `Cancelei ${esc(editing.cliente)}.`);
      return;
    }
    const list = await store.all();
    const [hh, mm] = editForm.inicio.value.split(":").map(Number);
    const inicioMin = hh * 60 + mm;
    const duracaoMin = Number(editForm.duracaoMin.value);
    const data = editForm.data.value;
    const day = fromIso(data);
    if (!isOpenDay(day)) {
      editErr.hidden = false;
      editErr.textContent = "Domingo o carro não roda.";
      return;
    }
    if (!inWindows(inicioMin, inicioMin + duracaoMin)) {
      editErr.hidden = false;
      editErr.textContent = "Fora da janela 8:30–11:30 / 14:00–18:00.";
      return;
    }
    const clash = conflicts(list, { data, inicioMin, duracaoMin, ignoreId: editing.id });
    if (clash.length) {
      editErr.hidden = false;
      editErr.textContent = `Choque com ${clash[0].cliente} às ${minutesToHHMM(clash[0].inicioMin)}.`;
      return;
    }
    const desconto = parseMoneyInput(editForm.desconto.value);
    const descontoHora = parseMoneyInput(editForm.descontoHora ? editForm.descontoHora.value : 0);
    Object.assign(editing, {
      cliente: editForm.cliente.value.trim(),
      servico: editForm.servico.value.trim() || "Carro de som",
      data,
      inicioMin,
      duracaoMin,
      observacoes: editForm.observacoes.value.trim(),
      desconto,
      descontoHora,
      pago: pagoEditing,
      updatedAt: new Date().toISOString(),
    });
    await store.put(editing);
    dlg.close();
    render();
    say("ok", `Salvei ${esc(editing.cliente)}.`);
  });

  function startOptions() {
    const out = [];
    for (const w of WINDOWS) {
      for (let t = w.start; t + SLOT <= w.end; t += SLOT) out.push(t);
    }
    return out;
  }
  function endOptions(start) {
    const w = WINDOWS.find((win) => start >= win.start && start < win.end);
    if (!w) return [];
    const out = [];
    for (let t = start + SLOT; t <= w.end; t += SLOT) out.push(t);
    return out;
  }
  function monthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function shiftMonth(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }
  function monthBounds() {
    const today = startOfDay(now());
    return {
      min: new Date(today.getFullYear(), today.getMonth(), 1),
      max: new Date(today.getFullYear(), today.getMonth() + 14, 1),
    };
  }
  function bookableDays(month) {
    const y = month.getFullYear();
    const m = month.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    const today = startOfDay(now());
    const out = [];
    for (let d = 1; d <= last; d++) {
      const dt = new Date(y, m, d);
      if (dt < today || !isOpenDay(dt)) continue;
      out.push(isoDate(dt));
    }
    return out;
  }
  function closeAdd() {
    const box = $("addDlg");
    if (box && box.open) box.close();
    addWaitName = false;
    if (cmd) cmd.placeholder = CMD_PLACEHOLDER;
  }
  function beginAddCliente() {
    closeAdd();
    addWaitName = true;
    pending = null;
    cmd.placeholder = "Nome do cliente. Ex.: Mearim Motos";
    cmd.focus();
    const tab = document.querySelector('.tab[data-panel="comandos"]');
    if (tab) tab.click();
    say("ok", "Qual o nome do cliente? Digita aqui embaixo e aperta Enviar.");
  }
  function openAddCalendar(cliente) {
    addState.cliente = cliente;
    addState.days = new Set();
    addState.step = "dias";
    addState.month = monthStart(startOfDay(now()));
    paintAdd();
    const box = $("addDlg");
    if (box && !box.open) box.showModal();
  }
  function addParsed() {
    const form = $("addForm");
    const inicioMin = Number(form.inicio.value);
    const fim = Number(form.fim.value);
    const duracaoMin = fim - inicioMin;
    const slots = [...addState.days].sort().map((data) => ({
      data,
      date: fromIso(data),
      inicioMin,
      duracaoMin,
    }));
    return {
      cliente: addState.cliente,
      servico: "Carro de som",
      missing: [],
      slots,
      durationAssumed: false,
    };
  }
  function fillEndOptions(prefer) {
    const form = $("addForm");
    if (!form) return;
    const start = Number(form.inicio.value);
    const ends = endOptions(start);
    const keep = prefer != null ? prefer : Number(form.fim.value);
    form.fim.innerHTML = ends.map((t) => `<option value="${t}">${minutesToHHMM(t)}</option>`).join("");
    form.fim.value = String(ends.includes(keep) ? keep : ends[0] || "");
  }
  function fillAddTimes() {
    const form = $("addForm");
    if (!form) return;
    const keepStart = Number(form.inicio.value) || hm("08:30");
    form.inicio.innerHTML = startOptions().map((t) => `<option value="${t}">${minutesToHHMM(t)}</option>`).join("");
    form.inicio.value = [...form.inicio.options].some((o) => Number(o.value) === keepStart)
      ? String(keepStart)
      : String(hm("08:30"));
    const keepEnd = Number(form.fim.value) || hm("09:30");
    fillEndOptions(keepEnd);
  }
  function paintAddCal() {
    const cal = $("addCal");
    if (!cal) return;
    const { min, max } = monthBounds();
    const month = addState.month;
    const label = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const y = month.getFullYear();
    const m = month.getMonth();
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const last = new Date(y, m + 1, 0).getDate();
    const today = startOfDay(now());
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push("<span></span>");
    for (let d = 1; d <= last; d++) {
      const dt = new Date(y, m, d);
      const iso = isoDate(dt);
      const shut = dt < today || !isOpenDay(dt);
      const on = addState.days.has(iso);
      cells.push(
        `<button type="button" class="pick-day${on ? " is-on" : ""}" data-day="${iso}"${shut ? " disabled" : ""} aria-pressed="${on ? "true" : "false"}">${d}</button>`
      );
    }
    const bookable = bookableDays(month);
    const allOn = bookable.length > 0 && bookable.every((d) => addState.days.has(d));
    const monthBtn = $("addMonth");
    if (monthBtn) monthBtn.textContent = allOn ? "Limpar o mês" : "Mês todo";
    cal.innerHTML = `<div class="pick-cal">
      <div class="pick-nav">
        <button type="button" data-month="-1"${month <= min ? " disabled" : ""} aria-label="Mês anterior">‹</button>
        <strong>${esc(label)}</strong>
        <button type="button" data-month="1"${month >= max ? " disabled" : ""} aria-label="Próximo mês">›</button>
      </div>
      <div class="pick-grid">
        ${["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => `<span class="pick-dow">${d}</span>`).join("")}
        ${cells.join("")}
      </div>
      <p class="pick-count">${addState.days.size ? `${addState.days.size} ${addState.days.size === 1 ? "dia marcado" : "dias marcados"}` : "Nenhum dia marcado."}</p>
    </div>`;
  }
  function paintAdd() {
    const err = $("addErr");
    if (err) err.hidden = true;
    const onDays = addState.step === "dias";
    const time = $("addTime");
    const cal = $("addCal");
    const monthBtn = $("addMonth");
    const next = $("addNext");
    const back = $("addBack");
    const title = $("addTitle");
    const lead = $("addLead");
    if (time) time.hidden = onDays;
    if (cal) cal.hidden = !onDays;
    if (monthBtn) monthBtn.hidden = !onDays;
    if (title) title.textContent = onDays ? "Quais dias?" : "Qual horário?";
    if (back) back.textContent = onDays ? "Fechar" : "Voltar";
    if (onDays) {
      if (lead) lead.textContent = `${addState.cliente}. Marca os dias. Domingo fica de fora.`;
      if (next) {
        next.textContent = "Próximo";
        next.disabled = addState.days.size === 0;
      }
      paintAddCal();
      return;
    }
    if (lead) lead.textContent = `${addState.cliente}. O mesmo horário vale em cada dia marcado.`;
    if (next) next.textContent = "Marcar";
    fillAddTimes();
    refreshAddHint();
  }
  async function refreshAddHint() {
    const hint = $("addTimeHint");
    const next = $("addNext");
    const err = $("addErr");
    if (!hint || addState.step !== "horario") return;
    const form = $("addForm");
    const inicioMin = Number(form.inicio.value);
    const fim = Number(form.fim.value);
    if (!endOptions(inicioMin).includes(fim)) {
      hint.textContent = "O fim fica na mesma parte do dia, sem atravessar o almoço.";
      if (next) next.disabled = true;
      return;
    }
    let list;
    try {
      list = await store.all();
    } catch {
      hint.textContent = "A agenda ainda está abrindo.";
      if (next) next.disabled = true;
      return;
    }
    const split = splitSlots(list, addParsed());
    const faixa = `${minutesToHHMM(inicioMin)}–${minutesToHHMM(fim)}`;
    const bits = [`${faixa} em ${split.ok.length} ${split.ok.length === 1 ? "dia livre" : "dias livres"}.`];
    if (split.blocked.length) bits.push(`${split.blocked.length} ${split.blocked.length === 1 ? "dia não entra" : "dias não entram"}.`);
    if (split.already.length) bits.push(`${split.already.length} já estavam com esse cliente.`);
    hint.textContent = bits.join(" ");
    if (next) next.disabled = split.ok.length === 0;
    if (!err) return;
    if (split.ok.length === 0) {
      err.hidden = false;
      err.textContent = split.blocked
        .slice(0, 3)
        .map((b) => (b.owner ? `${fmtLong(fromIso(b.s.data))} já está com ${b.owner}.` : `${fmtLong(fromIso(b.s.data))} não cabe nesse horário.`))
        .join(" ");
    } else err.hidden = true;
  }

  const addClienteBtn = $("addClienteBtn");
  if (addClienteBtn) addClienteBtn.addEventListener("click", beginAddCliente);
  const addCal = $("addCal");
  if (addCal) {
    addCal.addEventListener("click", (e) => {
      const monthBtn = e.target.closest("[data-month]");
      if (monthBtn && !monthBtn.disabled) {
        addState.month = shiftMonth(addState.month, Number(monthBtn.dataset.month));
        paintAddCal();
        return;
      }
      const day = e.target.closest("[data-day]");
      if (!day || day.disabled) return;
      if (addState.days.has(day.dataset.day)) addState.days.delete(day.dataset.day);
      else addState.days.add(day.dataset.day);
      paintAdd();
    });
  }
  const addMonthBtn = $("addMonth");
  if (addMonthBtn) {
    addMonthBtn.addEventListener("click", () => {
      const days = bookableDays(addState.month);
      const err = $("addErr");
      if (!days.length) {
        if (err) {
          err.hidden = false;
          err.textContent = "Esse mês já passou.";
        }
        return;
      }
      const allOn = days.every((d) => addState.days.has(d));
      for (const d of days) {
        if (allOn) addState.days.delete(d);
        else addState.days.add(d);
      }
      paintAdd();
    });
  }
  const addBack = $("addBack");
  if (addBack) {
    addBack.addEventListener("click", () => {
      if (addState.step === "horario") {
        addState.step = "dias";
        paintAdd();
        return;
      }
      closeAdd();
    });
  }
  const addCloseBtn = $("addClose");
  if (addCloseBtn) addCloseBtn.addEventListener("click", closeAdd);
  const addForm = $("addForm");
  if (addForm) {
    addForm.inicio.addEventListener("change", () => {
      fillEndOptions();
      refreshAddHint();
    });
    addForm.fim.addEventListener("change", () => refreshAddHint());
    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        if (addState.step === "dias") {
          if (!addState.days.size) return;
          addState.step = "horario";
          paintAdd();
          return;
        }
        const parsed = addParsed();
        const split = splitSlots(await store.all(), parsed);
        if (!split.ok.length) {
          await refreshAddHint();
          return;
        }
        closeAdd();
        await doBook(parsed);
      } catch (err) {
        say("bad", "Não consegui marcar: " + esc(err.message));
      }
    });
  }

  $("cmdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = cmd.value.trim();
    if (!text) return;
    sayMe(text);
    cmd.value = "";
    try {
      if (addWaitName) {
        const nome = sanitizeClient(text) || text.trim();
        if (!nome || nome.length < 2) {
          addWaitName = true;
          say("ok", "Não peguei o nome. Ex.: Mearim Motos.");
          return;
        }
        addWaitName = false;
        cmd.placeholder = CMD_PLACEHOLDER;
        openAddCalendar(nome);
        return;
      }
      if (await continuePending(text)) return;
      await runCommand(text);
    } catch (err) {
      say("bad", "Erro ao entender: " + esc(err.message));
    }
  });

  $("prevBtn").onclick = () => {
    if (view === "dia") cursor = addDays(cursor, -1);
    else if (view === "semana") cursor = addDays(cursor, -7);
    else cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    render();
  };
  $("nextBtn").onclick = () => {
    if (view === "dia") cursor = addDays(cursor, 1);
    else if (view === "semana") cursor = addDays(cursor, 7);
    else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    render();
  };
  $("hojeBtn").onclick = () => {
    cursor = startOfDay(now());
    render();
  };
  document.querySelectorAll(".views button").forEach((b) => {
    b.onclick = () => {
      view = b.dataset.view;
      render();
    };
  });
  document.querySelectorAll(".tab").forEach((b) => {
    b.onclick = () => {
      const panel = b.dataset.panel;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-on", x === b));
      const layout = document.querySelector(".layout");
      layout.classList.toggle("is-comandos", panel === "comandos");
      layout.classList.toggle("is-agenda", panel === "agenda");
      layout.classList.toggle("is-dashboard", panel === "dashboard");
      if (panel === "dashboard") renderDashFromStore();
    };
  });
  const layoutEl = document.querySelector(".layout");
  if (!layoutEl.classList.contains("is-agenda") && !layoutEl.classList.contains("is-dashboard") && !layoutEl.classList.contains("is-comandos")) {
    layoutEl.classList.add("is-agenda");
  }

  document.querySelectorAll("#dashRange button").forEach((b) => {
    b.onclick = () => {
      dashRange = b.dataset.range;
      document.querySelectorAll("#dashRange button").forEach((x) => x.classList.toggle("is-on", x === b));
      const custom = $("dashCustom");
      if (custom) custom.hidden = dashRange !== "periodo";
      if (dashRange === "periodo") {
        const { from, to } = dashBounds();
        if ($("dashFrom") && !$("dashFrom").value) $("dashFrom").value = from;
        if ($("dashTo") && !$("dashTo").value) $("dashTo").value = to;
      }
      renderDashFromStore();
    };
  });
  ["dashFrom", "dashTo"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", () => renderDashFromStore());
  });
  const histClienteEl = $("histCliente");
  if (histClienteEl) {
    histClienteEl.addEventListener("change", () => {
      histCliente = histClienteEl.value;
      renderDashFromStore();
    });
  }
  const histPagoEl = $("histPago");
  if (histPagoEl) {
    histPagoEl.addEventListener("change", () => {
      histPago = histPagoEl.value;
      renderDashFromStore();
    });
  }
  const rateEl = $("valorHora");
  if (rateEl) {
    rateEl.value = String(settings.valorHora);
    rateEl.addEventListener("change", () => {
      const v = Number(rateEl.value);
      settings.valorHora = Number.isFinite(v) && v >= 0 ? v : DEFAULT_RATE;
      persistSettings();
      refreshEditTotal();
      renderDashFromStore();
    });
  }
  persistSettings();
  const payForm = $("payForm");
  if (payForm) {
    payForm.valor.addEventListener("input", refreshPayPreview);
    payForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const err = $("payErr");
      if (!payTarget) return;
      const valor = parseMoneyInput(payForm.valor.value);
      const data = payForm.data.value;
      const { from, to } = dashBounds();
      if (!(valor > 0)) {
        if (err) {
          err.hidden = false;
          err.textContent = "Informe um valor maior que zero.";
        }
        return;
      }
      if (!data || data < from || data > to) {
        if (err) {
          err.hidden = false;
          err.textContent = `Escolha uma data entre ${fmtIso(from)} e ${fmtIso(to)}.`;
        }
        return;
      }
      if (err) err.hidden = true;
      payments.push({
        id: uid(),
        cliente: payTarget.cliente,
        data,
        valor,
        createdAt: new Date().toISOString(),
      });
      persistPayments();
      payForm.valor.value = "";
      render();
    });
  }
  const payFill = $("payFill");
  if (payFill) {
    payFill.addEventListener("click", () => {
      if (!payTarget || !payForm) return;
      const pendente = round2((payTarget.total || 0) - (payTarget.pago || 0));
      const err = $("payErr");
      if (!(pendente > 0)) {
        if (err) {
          err.hidden = false;
          err.textContent = "Não há pendente neste período. Digite o adiantamento.";
        }
        return;
      }
      if (err) err.hidden = true;
      payForm.valor.value = String(pendente).replace(".", ",");
      refreshPayPreview();
      payForm.valor.focus();
    });
  }
  const payClose = $("payClose");
  if (payClose) {
    payClose.addEventListener("click", () => {
      const dlg = $("payDlg");
      if (dlg) dlg.close();
      payTarget = null;
    });
  }
  const discForm = $("discForm");
  if (discForm) {
    discForm.valor.addEventListener("input", refreshDiscPreview);
    discForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const err = $("discErr");
      if (!discTarget) return;
      const typed = parseMoneyInput(discForm.valor.value);
      const data = discForm.data.value;
      const { from, to } = dashBounds();
      const room = round2(Math.max(0, (discTarget.bruto || 0) - (discTarget.desconto || 0)));
      if (!(typed > 0)) {
        if (err) {
          err.hidden = false;
          err.textContent = "Informe um desconto maior que zero.";
        }
        return;
      }
      if (!(room > 0)) {
        if (err) {
          err.hidden = false;
          err.textContent = "Não há valor para descontar neste período.";
        }
        return;
      }
      if (!data || data < from || data > to) {
        if (err) {
          err.hidden = false;
          err.textContent = `Escolha uma data entre ${fmtIso(from)} e ${fmtIso(to)}.`;
        }
        return;
      }
      if (err) err.hidden = true;
      discounts.push({
        id: uid(),
        cliente: discTarget.cliente,
        data,
        valor: Math.min(typed, room),
        createdAt: new Date().toISOString(),
      });
      persistDiscounts();
      discForm.valor.value = "";
      render();
    });
  }
  const discFill = $("discFill");
  if (discFill) {
    discFill.addEventListener("click", () => {
      if (!discTarget || !discForm) return;
      const err = $("discErr");
      const room = round2(Math.max(0, (discTarget.bruto || 0) - (discTarget.desconto || 0)));
      const pendente = round2(discTarget.pendente || 0);
      const valor = Math.min(room, pendente);
      if (!(valor > 0)) {
        if (err) {
          err.hidden = false;
          err.textContent = "Não há pendente para descontar neste período.";
        }
        return;
      }
      if (err) err.hidden = true;
      discForm.valor.value = String(valor).replace(".", ",");
      refreshDiscPreview();
      discForm.valor.focus();
    });
  }
  const discClose = $("discClose");
  if (discClose) {
    discClose.addEventListener("click", () => {
      const dlg = $("discDlg");
      if (dlg) dlg.close();
      discTarget = null;
    });
  }
  const discList = $("discList");
  if (discList) {
    discList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-drop-disc]");
      if (!btn) return;
      discounts = discounts.filter((p) => p.id !== btn.dataset.dropDisc);
      persistDiscounts();
      render();
    });
  }
  const payList = $("payList");
  if (payList) {
    payList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-drop-pay]");
      if (!btn) return;
      payments = payments.filter((p) => p.id !== btn.dataset.dropPay);
      persistPayments();
      render();
    });
  }
  const pagoBtn = $("pagoBtn");
  if (pagoBtn) {
    pagoBtn.addEventListener("click", () => {
      setPagoBtn(!pagoEditing);
      refreshEditTotal();
    });
  }
  if (editForm.desconto) editForm.desconto.addEventListener("input", refreshEditTotal);
  if (editForm.descontoHora) editForm.descontoHora.addEventListener("input", refreshEditTotal);
  if (editForm.duracaoMin) editForm.duracaoMin.addEventListener("change", refreshEditTotal);

  cmd.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("cmdForm").requestSubmit();
    }
  });

  say("ok", "Agenda do carro pronta. Segunda a sábado, 8:30–11:30 e 14:00–18:00. Domingo fechado. Manda o cliente e o horário, ou clica em Adicionar cliente.");

  async function pullFile() {
    try {
      const res = await fetch("data/agenda.json?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const items = await res.json();
      if (Array.isArray(items) && items.length) await store.importAll(items);
    } catch (_) { /* arquivo opcional */ }
  }

  store.open().then(async (d) => {
    db = d;
    await pullFile();
    render();
  }).catch((err) => say("bad", "Banco local não abriu: " + err.message));
})();
