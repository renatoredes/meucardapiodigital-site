(function (global) {
  "use strict";

  const DB_NAME = "mcd-leads";
  const STORE = "leads";
  const DB_VERSION = 1;
  const RATE_KEY = "mcd-lead-rate";

  const ESTABELECIMENTO_TIPOS = [
    "Restaurante",
    "Lanchonete",
    "Pizzaria",
    "Hamburgueria",
    "Café / Padaria",
    "Açaí / Sorveteria",
    "Food truck",
    "Bar / Pub",
    "Outro",
  ];

  const STATUS = {
    NOVO: "novo",
    CONTATADO: "contatado",
    CONVERTIDO: "convertido",
    DESCARTADO: "descartado",
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("createdAt", "createdAt", { unique: false });
          os.createIndex("status", "status", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  }

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "ld_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function sanitize(lead) {
    const trim = (v) => String(v ?? "").trim();
    return {
      nome: trim(lead.nome).slice(0, 120),
      estabelecimento: trim(lead.estabelecimento).slice(0, 160),
      whatsapp: trim(lead.whatsapp).replace(/[^\d+\s()-]/g, "").slice(0, 20),
      email: trim(lead.email).toLowerCase().slice(0, 160),
      cidadeEstado: trim(lead.cidadeEstado).slice(0, 120),
      tipoEstabelecimento: trim(lead.tipoEstabelecimento).slice(0, 80),
      mensagem: trim(lead.mensagem).slice(0, 2000),
      receberInfo: Boolean(lead.receberInfo),
    };
  }

  function validate(raw) {
    const data = sanitize(raw);
    const errors = {};

    if (data.nome.length < 2) errors.nome = "Informe seu nome.";
    if (data.estabelecimento.length < 2)
      errors.estabelecimento = "Informe o nome do estabelecimento.";
    if (!/^\+?[\d\s()-]{10,20}$/.test(data.whatsapp))
      errors.whatsapp = "Informe um WhatsApp válido com DDD.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      errors.email = "Informe um e-mail válido.";
    if (data.cidadeEstado.length < 2)
      errors.cidadeEstado = "Informe cidade e estado.";
    if (!data.tipoEstabelecimento)
      errors.tipoEstabelecimento = "Selecione o tipo de estabelecimento.";

    return { ok: Object.keys(errors).length === 0, errors, data };
  }

  function checkRateLimit(maxPerHour) {
    const now = Date.now();
    let stamps = [];
    try {
      stamps = JSON.parse(localStorage.getItem(RATE_KEY) || "[]");
    } catch (_) {
      stamps = [];
    }
    stamps = stamps.filter((t) => now - t < 60 * 60 * 1000);
    if (stamps.length >= maxPerHour) {
      return { ok: false, stamps };
    }
    return { ok: true, stamps };
  }

  function recordSubmit(stamps) {
    stamps.push(Date.now());
    localStorage.setItem(RATE_KEY, JSON.stringify(stamps));
  }

  const LeadRepository = {
    async create(lead) {
      const record = {
        id: uid(),
        ...lead,
        status: STATUS.NOVO,
        createdAt: new Date().toISOString(),
      };
      await withStore("readwrite", (store) => store.add(record));
      return record;
    },

    async list() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          const rows = req.result || [];
          rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async updateStatus(id, status) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const row = getReq.result;
          if (!row) {
            reject(new Error("Lead não encontrado"));
            return;
          }
          row.status = status;
          row.updatedAt = new Date().toISOString();
          store.put(row);
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    },

    async clearAll() {
      await withStore("readwrite", (store) => store.clear());
    },
  };

  async function postToEmail(cfg, record) {
    const target = cfg.formsubmitId;
    if (!target) return null;

    const message = [
      "Novo lead — Meu Cardápio Digital",
      "",
      "Nome: " + record.nome,
      "Estabelecimento: " + record.estabelecimento,
      "WhatsApp: " + record.whatsapp,
      "E-mail: " + record.email,
      "Cidade/Estado: " + record.cidadeEstado,
      "Tipo: " + record.tipoEstabelecimento,
      "Receber informacoes: " + (record.receberInfo ? "Sim" : "Nao"),
      "Data/hora: " + record.createdAt,
      "",
      "Mensagem:",
      record.mensagem || "(sem mensagem)",
    ].join("\n");

    const body = new URLSearchParams({
      _subject: "Novo lead — Meu Cardápio Digital",
      _captcha: "false",
      _replyto: record.email,
      name: record.nome,
      email: record.email,
      estabelecimento: record.estabelecimento,
      whatsapp: record.whatsapp,
      cidade_estado: record.cidadeEstado,
      tipo: record.tipoEstabelecimento,
      message: message,
    });

    const res = await fetch(
      "https://formsubmit.co/ajax/" + encodeURIComponent(target),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === "false" || json.success === false) {
      throw new Error(json.message || "Falha ao enviar o e-mail.");
    }
    return json;
  }

  async function postRemote(endpoint, record) {
    if (!endpoint) return null;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        nome: record.nome,
        estabelecimento: record.estabelecimento,
        whatsapp: record.whatsapp,
        email: record.email,
        cidadeEstado: record.cidadeEstado,
        tipoEstabelecimento: record.tipoEstabelecimento,
        mensagem: record.mensagem || null,
        receberInfo: record.receberInfo,
        createdAt: record.createdAt,
        source: "landing",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Falha ao enviar para o servidor.");
    }
    return res;
  }

  const LeadService = {
    tipos: ESTABELECIMENTO_TIPOS,
    status: STATUS,

    async submit(payload, options) {
      const cfg = global.MCD_CONFIG || {};
      const minSeconds = options.minSeconds ?? cfg.minFormSeconds ?? 4;
      const maxPerHour = options.maxPerHour ?? cfg.maxSubmitsPerHour ?? 5;
      const pageOpenedAt = options.pageOpenedAt || Date.now();

      if (payload.website) {
        return { ok: true, spam: true };
      }

      if (Date.now() - pageOpenedAt < minSeconds * 1000) {
        return {
          ok: false,
          error: "Aguarde um instante e tente novamente.",
        };
      }

      const rate = checkRateLimit(maxPerHour);
      if (!rate.ok) {
        return {
          ok: false,
          error: "Muitas tentativas. Tente novamente mais tarde.",
        };
      }

      const { ok, errors, data } = validate(payload);
      if (!ok) return { ok: false, errors };

      const record = await LeadRepository.create(data);

      try {
        await postToEmail(cfg, record);
        await postRemote(cfg.leadsEndpoint, record);
      } catch (err) {
        return {
          ok: false,
          error:
            "Não foi possível enviar sua solicitação agora. Tente novamente em instantes.",
          detail: String(err && err.message ? err.message : err),
        };
      }

      recordSubmit(rate.stamps);
      return { ok: true, id: record.id };
    },

    list: () => LeadRepository.list(),
    updateStatus: (id, status) => LeadRepository.updateStatus(id, status),
    sha256Hex,
    validate,
  };

  global.MCD = { LeadService, LeadRepository };
})(typeof window !== "undefined" ? window : globalThis);
