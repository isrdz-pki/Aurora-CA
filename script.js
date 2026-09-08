// ========================================
// CertDigital - Static Site JavaScript
// (ajustado para: 1) persistência do download após reload
//                2) botão de download desabilitado até existir download_id
//                3) pequenos guards + correções de SVG)
// ========================================

const API_BASE = "https://aurora-production-de38.up.railway.app";

// Guarda o id do certificado gerado (até o usuário recarregar a página)
let downloadId = sessionStorage.getItem("download_id") || null;

document.addEventListener("DOMContentLoaded", function () {
  // Initialize validation form if present
  const validationForm = document.getElementById("validationForm");
  if (validationForm) {
    initValidationForm();
  }

  // Initialize download button if present
  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) {
    initDownloadButton();
  }

  // Se já existe download_id salvo (usuário recarregou a página), mostra o card de sucesso
  restoreDownloadStateUI();

  // Smooth scroll for anchor links
  initSmoothScroll();
});

// ========================================
// Restore UI state (quando existe download_id no sessionStorage)
// ========================================
function restoreDownloadStateUI() {
  const formCard = document.getElementById("formCard");
  const successCard = document.getElementById("successCard");
  const downloadBtn = document.getElementById("downloadBtn");

  // Só faz algo se estiver na página de validação (cards existirem)
  if (!formCard || !successCard) return;

  if (downloadId) {
    formCard.style.display = "none";
    successCard.style.display = "block";
    // Deixa o botão pronto para baixar (se existir)
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.classList.remove("disabled");
    }
  } else {
    // Sem download_id → garante o estado normal
    if (downloadBtn) {
      downloadBtn.disabled = true; // evita erro/confusão
      downloadBtn.classList.add("disabled");
    }
  }
}

// ========================================
// Smooth Scroll
// ========================================
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute("href"));
      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  });
}

// ========================================
// Form Validation + "Validate" action
// ========================================
function initValidationForm() {
  const form = document.getElementById("validationForm");
  const formCard = document.getElementById("formCard");
  const successCard = document.getElementById("successCard");
  const submitBtn = document.getElementById("submitBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  // Input masks
  const cpfInput = document.getElementById("cpf");
  const telefoneInput = document.getElementById("telefone");

  if (cpfInput) {
    cpfInput.addEventListener("input", function (e) {
      e.target.value = formatCPF(e.target.value);
    });
  }

  if (telefoneInput) {
    telefoneInput.addEventListener("input", function (e) {
      e.target.value = formatPhone(e.target.value);
    });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    clearErrors();

    const formData = {
      nome: document.getElementById("nome").value.trim(),
      email: document.getElementById("email").value.trim(),
      telefone: document.getElementById("telefone").value.trim(),
      cpf: document.getElementById("cpf").value.trim(),
      endereco: document.getElementById("endereco").value.trim(),
    };

    const errors = validateForm(formData);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }

    setLoading(true);

    try {
      // 1) Gera e "guarda" no backend → devolve download_id
      const response = await fetch(`${API_BASE}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        let msg = "Erro ao validar/gerar certificado";
        try {
          const data = await response.json();
          if (data?.detail) msg = data.detail;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await response.json();
      if (!data?.download_id) {
        throw new Error("API não retornou download_id");
      }

      downloadId = data.download_id;
      sessionStorage.setItem("download_id", downloadId);

      // 2) Mostra o card de sucesso (com botão de download)
      if (formCard) formCard.style.display = "none";
      if (successCard) successCard.style.display = "block";

      // 3) Libera o botão de download (se existir)
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove("disabled");
      }
    } catch (error) {
      alert(error.message || "Ocorreu um erro ao gerar o certificado. Tente novamente.");
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  });

  function setLoading(loading) {
    if (!submitBtn) return;

    if (loading) {
      submitBtn.classList.add("loading");
      submitBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">
          <line x1="12" y1="2" x2="12" y2="6"/>
          <line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="6" y2="12"/>
          <line x1="18" y1="12" x2="22" y2="12"/>
          <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
          <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
        </svg>
        Validando...
      `;
    } else {
      submitBtn.classList.remove("loading");
      submitBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        Validar Certificado
      `;
    }
  }
}

// ========================================
// Download Certificate (GET /download/{download_id})
// ========================================
function initDownloadButton() {
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadError = document.getElementById("downloadError");
  const downloadErrorText = document.getElementById("downloadErrorText");

  if (!downloadBtn) return;

  // Estado inicial: desabilita se não tiver downloadId
  if (!downloadId) {
    downloadBtn.disabled = true;
    downloadBtn.classList.add("disabled");
  }

  downloadBtn.addEventListener("click", async function () {
    // Se estiver desabilitado, não faz nada
    if (downloadBtn.disabled) return;

    if (downloadError) downloadError.style.display = "none";
    setDownloadLoading(true);

    try {
      if (!downloadId) {
        // tenta recuperar se o usuário recarregou
        downloadId = sessionStorage.getItem("download_id");
      }
      if (!downloadId) {
        throw new Error("Nenhum certificado gerado ainda. Clique em 'Validar Certificado' primeiro.");
      }

      const response = await fetch(`${API_BASE}/download/${downloadId}`, {
        method: "GET",
      });

      if (!response.ok) {
        let msg = "Erro ao baixar certificado";
        try {
          const data = await response.json();
          if (data?.detail) msg = data.detail;
        } catch (_) {}
        throw new Error(msg);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "certificado.pfx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);

      // opcional: limpa o id após baixar (backend também apaga)
      sessionStorage.removeItem("download_id");
      downloadId = null;

      // volta a bloquear o botão para evitar downloads repetidos inválidos
      downloadBtn.disabled = true;
      downloadBtn.classList.add("disabled");
    } catch (error) {
      if (downloadErrorText) {
        downloadErrorText.textContent =
          error.message || "Erro ao baixar o certificado. Tente novamente mais tarde.";
      }
      if (downloadError) downloadError.style.display = "flex";
    } finally {
      setDownloadLoading(false);
    }
  });

  function setDownloadLoading(loading) {
    if (!downloadBtn) return;

    if (loading) {
      downloadBtn.classList.add("loading");
      downloadBtn.disabled = true;

      downloadBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin">
          <line x1="12" y1="2" x2="12" y2="6"/>
          <line x1="12" y1="18" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="6" y2="12"/>
          <line x1="18" y1="12" x2="22" y2="12"/>
          <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
          <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
        </svg>
        Baixando...
      `;
    } else {
      downloadBtn.classList.remove("loading");

      // só re-habilita se ainda existir downloadId
      if (downloadId) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove("disabled");
      } else {
        downloadBtn.disabled = true;
        downloadBtn.classList.add("disabled");
      }

      downloadBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Baixar Certificado
      `;
    }
  }
}

// ========================================
// Validation Functions
// ========================================
function validateForm(data) {
  const errors = {};

  if (!data.nome || data.nome.length < 3) {
    errors.nome = "Nome deve ter pelo menos 3 caracteres";
  } else if (data.nome.length > 100) {
    errors.nome = "Nome deve ter no máximo 100 caracteres";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!data.email || !emailRegex.test(data.email)) {
    errors.email = "E-mail inválido";
  }

  const phoneNumbers = data.telefone.replace(/\D/g, "");
  if (phoneNumbers.length < 10 || phoneNumbers.length > 11) {
    errors.telefone = "Telefone deve ter 10 ou 11 dígitos";
  }

  const cpfNumbers = data.cpf.replace(/\D/g, "");
  if (cpfNumbers.length !== 11) {
    errors.cpf = "CPF inválido";
  }

  if (!data.endereco || data.endereco.length < 10) {
    errors.endereco = "Endereço deve ter pelo menos 10 caracteres";
  }

  return errors;
}

function showErrors(errors) {
  Object.keys(errors).forEach((field) => {
    const input = document.getElementById(field);
    const errorSpan = document.getElementById(field + "Error");

    if (input) input.classList.add("error");
    if (errorSpan) errorSpan.textContent = errors[field];
  });
}

function clearErrors() {
  document.querySelectorAll(".form-group input").forEach((input) => {
    input.classList.remove("error");
  });
  document.querySelectorAll(".error-message").forEach((span) => {
    span.textContent = "";
  });
}

// ========================================
// Format Functions
// ========================================
function formatCPF(value) {
  const numbers = value.replace(/\D/g, "");

  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) return numbers.slice(0, 3) + "." + numbers.slice(3);
  if (numbers.length <= 9)
    return numbers.slice(0, 3) + "." + numbers.slice(3, 6) + "." + numbers.slice(6);

  return (
    numbers.slice(0, 3) +
    "." +
    numbers.slice(3, 6) +
    "." +
    numbers.slice(6, 9) +
    "-" +
    numbers.slice(9, 11)
  );
}

function formatPhone(value) {
  const numbers = value.replace(/\D/g, "");

  if (numbers.length <= 2) return "(" + numbers;
  if (numbers.length <= 7) return "(" + numbers.slice(0, 2) + ") " + numbers.slice(2);

  return "(" + numbers.slice(0, 2) + ") " + numbers.slice(2, 7) + "-" + numbers.slice(7, 11);
}
