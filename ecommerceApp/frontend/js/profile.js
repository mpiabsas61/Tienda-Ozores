import {
  fetchMyOrders,
  fetchMyProfile,
  formatArsCurrency,
  getFriendlyRoleLabel,
  getStoredUser,
  logoutSession,
  updateMyProfile,
} from "./shared.js";

const user = getStoredUser();
let profile = user ? { ...user } : null;

if (!user) {
  window.location.replace("login.html");
}

function renderProfile(profileInfo) {
  const fullName = [profileInfo.nombre, profileInfo.apellido].filter(Boolean).join(" ");
  document.getElementById("profile-name").textContent = fullName || "Usuario";
  document.getElementById("profile-email").textContent = profileInfo.email ?? "";
  document.getElementById("profile-phone").textContent = profileInfo.telefono || "No informado";
  document.getElementById("profile-birthdate").textContent = profileInfo.fecha_nacimiento || "No informada";
  document.getElementById("profile-role").textContent = getFriendlyRoleLabel(user) || "cliente";
}

function setProfileMessage(message, type = "danger") {
  const profileMessage = document.getElementById("profile-message");
  profileMessage.textContent = message;
  profileMessage.className = `alert alert-${type} mt-3 mb-0`;
  profileMessage.setAttribute("role", type === "danger" ? "alert" : "status");
}

function clearProfileMessage() {
  const profileMessage = document.getElementById("profile-message");
  profileMessage.textContent = "";
  profileMessage.className = "alert d-none mt-3 mb-0";
}

function fillProfileForm(profileInfo) {
  document.getElementById("profile-edit-name").value = profileInfo.nombre ?? "";
  document.getElementById("profile-edit-lastname").value = profileInfo.apellido ?? "";
  document.getElementById("profile-edit-email").value = profileInfo.email ?? "";
  document.getElementById("profile-edit-phone").value = profileInfo.telefono ?? "";
  document.getElementById("profile-edit-birthdate").value = profileInfo.fecha_nacimiento ?? "";
}

async function loadProfile() {
  const latestProfile = await fetchMyProfile();
  profile = latestProfile;
  Object.assign(user, latestProfile);
  localStorage.setItem("user", JSON.stringify(user));
  renderProfile(profile);

  const editButton = document.getElementById("profile-edit-button");
  editButton.disabled = user.role !== "client";
  editButton.classList.toggle("d-none", user.role !== "client");
}

function renderOrders(orders = []) {
  const emptyState = document.getElementById("orders-empty-state");
  const list = document.getElementById("orders-list");

  if (!orders.length) {
    emptyState.classList.remove("d-none");
    list.innerHTML = "";
    return;
  }

  emptyState.classList.add("d-none");
  list.innerHTML = orders
    .map((order) => {
      const orderDate = String(order.fecha_compra ?? "").slice(0, 10);
      const couponLabel = order.cupon?.nombre ? `Cupón: ${order.cupon.nombre}` : "Sin cupón";
      const details = Array.isArray(order.detalles) ? order.detalles : [];

      return `
        <article class="border rounded-3 p-3 bg-white">
          <div class="d-flex flex-column flex-sm-row justify-content-between gap-2 mb-3">
            <div>
              <div class="fw-semibold">Orden #${order.id_orden}</div>
              <div class="small text-muted">${orderDate}</div>
            </div>
            <div class="text-sm-end">
              <div class="fw-semibold">${formatArsCurrency(order.total ?? 0)}</div>
              <div class="small text-muted">${couponLabel}</div>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Producto</th>
                  <th class="text-center">Cantidad</th>
                  <th class="text-end">Precio unitario</th>
                  <th class="text-end">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${details
                  .map((detail) => {
                    const productName = detail.producto?.nombre ?? "Producto eliminado";
                    const quantity = Number(detail.cantidad ?? 0);
                    const unitPrice = Number(detail.precio_unitario ?? 0);
                    const subtotal = quantity * unitPrice;

                    return `
                      <tr>
                        <td>${productName}</td>
                        <td class="text-center">${quantity}</td>
                        <td class="text-end">${formatArsCurrency(unitPrice)}</td>
                        <td class="text-end">${formatArsCurrency(subtotal)}</td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadOrders() {
  const orders = await fetchMyOrders();
  renderOrders(Array.isArray(orders) ? orders : []);
}

document.getElementById("logout-button").addEventListener("click", () => {
  logoutSession();
  window.location.replace("login.html");
});

const editButton = document.getElementById("profile-edit-button");
const editForm = document.getElementById("profile-edit-form");

editButton.addEventListener("click", () => {
  clearProfileMessage();
  fillProfileForm(profile);
  editForm.classList.remove("d-none");
  editButton.setAttribute("aria-expanded", "true");
  document.getElementById("profile-edit-name").focus();
});

document.getElementById("profile-cancel-button").addEventListener("click", () => {
  editForm.classList.add("d-none");
  editButton.setAttribute("aria-expanded", "false");
  clearProfileMessage();
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearProfileMessage();

  const saveButton = document.getElementById("profile-save-button");
  saveButton.disabled = true;
  saveButton.textContent = "Guardando...";

  try {
    const updatedProfile = await updateMyProfile({
      nombre: document.getElementById("profile-edit-name").value.trim(),
      apellido: document.getElementById("profile-edit-lastname").value.trim(),
      telefono: document.getElementById("profile-edit-phone").value.trim(),
      fecha_nacimiento: document.getElementById("profile-edit-birthdate").value,
    });
    profile = updatedProfile;
    Object.assign(user, updatedProfile);
    localStorage.setItem("user", JSON.stringify(user));
    renderProfile(profile);
    fillProfileForm(profile);
    editForm.classList.add("d-none");
    editButton.setAttribute("aria-expanded", "false");
    setProfileMessage("Tus datos se actualizaron correctamente.", "success");
  } catch (error) {
    setProfileMessage(error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Guardar cambios";
  }
});

renderProfile(profile);
loadProfile().catch((error) => {
  const editButton = document.getElementById("profile-edit-button");
  editButton.disabled = true;
  setProfileMessage(error.message);
});

loadOrders().catch((error) => {
  const list = document.getElementById("orders-list");
  list.innerHTML = `<div class="alert alert-danger mb-0">${error.message}</div>`;
});
