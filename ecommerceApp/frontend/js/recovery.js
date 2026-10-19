import { requestPasswordReset, resetPassword } from "./shared.js";

const requestForm = document.getElementById("recovery-request-form");
const resetForm = document.getElementById("recovery-reset-form");
const emailInput = document.getElementById("recovery-email");
const message = document.getElementById("recovery-message");

function setMessage(text, tone = "muted") {
  message.className = `small mb-3 text-${tone}`;
  message.textContent = text;
}

function setButtonLoading(button, loading, label, loadingLabel) {
  button.disabled = loading;
  button.textContent = loading ? loadingLabel : label;
}

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("request-recovery-button");
  const email = emailInput.value.trim();

  setMessage("");
  setButtonLoading(button, true, "Solicitar código", "Solicitando...");

  try {
    const result = await requestPasswordReset(email);
    requestForm.classList.add("d-none");
    resetForm.classList.remove("d-none");
    setMessage(
      `${result.mensaje} En desarrollo, revisá la consola del servidor para obtenerlo.`,
      "success",
    );
  } catch (error) {
    setMessage(error.message, "danger");
  } finally {
    setButtonLoading(button, false, "Solicitar código", "Solicitando...");
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = document.getElementById("recovery-password").value;
  const passwordConfirm = document.getElementById("recovery-password-confirm").value;
  const button = document.getElementById("reset-password-button");

  if (password !== passwordConfirm) {
    setMessage("Las contraseñas no coinciden.", "danger");
    return;
  }

  setMessage("");
  setButtonLoading(button, true, "Cambiar contraseña", "Actualizando...");

  try {
    await resetPassword({
      email: emailInput.value.trim(),
      code: document.getElementById("recovery-code").value.trim(),
      password,
    });
    window.location.replace("login.html?passwordReset=1");
  } catch (error) {
    setMessage(error.message, "danger");
  } finally {
    setButtonLoading(button, false, "Cambiar contraseña", "Actualizando...");
  }
});
