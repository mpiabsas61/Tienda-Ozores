import { getStoredUser, registerUser } from "./shared.js";

const nextAction = new URLSearchParams(window.location.search).get("next");
const loginLink = document.querySelector('a[href="login.html"]');

if (loginLink && nextAction) {
  loginLink.href = `login.html?next=${encodeURIComponent(nextAction)}`;
}

if (getStoredUser()) {
  window.location.replace("index.html");
}

if (nextAction === "checkout") {
  const contextMessage = document.getElementById("register-context-message");
  contextMessage.textContent = "Creá tu cuenta para continuar con la compra.";
  contextMessage.classList.remove("d-none");
}

document.getElementById("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const nombre = document.getElementById("register-nombre").value.trim();
  const apellido = document.getElementById("register-apellido").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  const passwordConfirm = document.getElementById("register-password-confirm").value;
  const registerMessage = document.getElementById("register-message");

  registerMessage.textContent = "";

  if (password !== passwordConfirm) {
    registerMessage.textContent = "Las contraseñas no coinciden.";
    return;
  }

  try {
    await registerUser({ nombre, apellido, email, password });
    const target = nextAction === "checkout" ? "login.html?next=checkout&registered=1" : "login.html?registered=1";
    window.location.replace(target);
  } catch (error) {
    registerMessage.textContent = error.message;
  }
});
