(function () {
  "use strict";

  const pageOpenedAt = Date.now();
  const form = document.getElementById("lead-form");
  const feedback = document.getElementById("form-feedback");
  const submitBtn = document.getElementById("submit-lead");
  const tipoSelect = document.getElementById("tipoEstabelecimento");
  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");

  if (tipoSelect && window.MCD) {
    window.MCD.LeadService.tipos.forEach((tipo) => {
      const opt = document.createElement("option");
      opt.value = tipo;
      opt.textContent = tipo;
      tipoSelect.appendChild(opt);
    });
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  function clearErrors() {
    form.querySelectorAll(".field__error").forEach((el) => {
      el.textContent = "";
    });
    form.querySelectorAll(".is-invalid").forEach((el) => {
      el.classList.remove("is-invalid");
    });
  }

  function showFieldErrors(errors) {
    Object.entries(errors).forEach(([key, msg]) => {
      const input = form.elements[key];
      const err = form.querySelector(`[data-error-for="${key}"]`);
      if (input) input.classList.add("is-invalid");
      if (err) err.textContent = msg;
    });
  }

  function showFeedback(type, message) {
    feedback.className =
      "form-feedback is-visible form-feedback--" + (type === "ok" ? "ok" : "err");
    feedback.textContent = message;
    feedback.setAttribute("role", type === "ok" ? "status" : "alert");
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span> Enviando…'
      : "Quero conhecer a plataforma";
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors();
      feedback.className = "form-feedback";
      feedback.textContent = "";

      const fd = new FormData(form);
      const payload = {
        nome: fd.get("nome"),
        estabelecimento: fd.get("estabelecimento"),
        whatsapp: fd.get("whatsapp"),
        email: fd.get("email"),
        cidadeEstado: fd.get("cidadeEstado"),
        tipoEstabelecimento: fd.get("tipoEstabelecimento"),
        mensagem: fd.get("mensagem"),
        receberInfo: fd.get("receberInfo") === "on",
        website: fd.get("website"),
      };

      setLoading(true);
      try {
        const result = await window.MCD.LeadService.submit(payload, {
          pageOpenedAt,
        });

        if (result.spam) {
          showFeedback(
            "ok",
            "Recebemos seu interesse. Em breve entraremos em contato."
          );
          form.reset();
          return;
        }

        if (!result.ok) {
          if (result.errors) showFieldErrors(result.errors);
          showFeedback(
            "err",
            result.error || "Revise os campos destacados e tente novamente."
          );
          return;
        }

        showFeedback(
          "ok",
          "Pronto! Recebemos seu interesse. Nossa equipe entrará em contato em breve."
        );
        form.reset();
        form.querySelector("#receberInfo").checked = true;
      } catch (_) {
        showFeedback(
          "err",
          "Não foi possível enviar agora. Verifique sua conexão e tente de novo."
        );
      } finally {
        setLoading(false);
      }
    });
  }

  const reveals = document.querySelectorAll(".reveal");
  if (reveals.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }
})();
