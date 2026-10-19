import { getStoredUser, loginUser } from "./shared.js";

const nextAction = new URLSearchParams(window.location.search).get("next");
const registerLink = document.querySelector('a[href="register.html"]');

if (registerLink && nextAction) {
  registerLink.href = `register.html?next=${encodeURIComponent(nextAction)}`;
}

if (getStoredUser()) {
  window.location.replace("index.html");
}

if (nextAction === "checkout") {
  const contextMessage = document.getElementById("login-context-message");
  contextMessage.textContent = "Iniciá sesión para finalizar tu compra.";
  contextMessage.classList.remove("d-none");
}

if (new URLSearchParams(window.location.search).get("passwordReset") === "1") {
  const contextMessage = document.getElementById("login-context-message");
  contextMessage.textContent = "Tu contraseña se actualizó correctamente. Ya podés iniciar sesión.";
  contextMessage.classList.remove("d-none");
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const loginMessage = document.getElementById("login-message");

  loginMessage.textContent = "";

  try {
    await loginUser(email, password);
    if (nextAction === "checkout") {
      window.location.replace("index.html?checkout=1");
      return;
    }

    window.location.replace("index.html");
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});
