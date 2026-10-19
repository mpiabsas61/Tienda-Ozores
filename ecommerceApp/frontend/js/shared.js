const SYNC_CHANNEL_NAME = "ecommerce-product-sync";
const STORAGE_SYNC_KEY = "ecommerce-product-sync";
const syncChannel =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel(SYNC_CHANNEL_NAME)
    : null;

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatMoney(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("es-AR");
}

export function formatDecimalInput(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export function formatArsCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "$0,00";
  }

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(amount)
    .replace(/\s+/g, "");
}

export function formatDiscountPercentage(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  const formatted = Number.isInteger(amount)
    ? String(amount)
    : amount.toLocaleString("es-AR", { maximumFractionDigits: 1 });

  return `-${formatted}%`;
}

export function formatDiscountBadge(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  const formatted = Number.isInteger(amount)
    ? String(amount)
    : amount.toLocaleString("es-AR", { maximumFractionDigits: 1 });

  return `${formatted}% OFF`;
}

export function calculateDiscountedPrice(price, percentage) {
  const basePrice = Number(price);
  const discount = Number(percentage);

  if (!Number.isFinite(basePrice) || !Number.isFinite(discount) || discount <= 0) {
    return basePrice;
  }

  return Math.max(0, basePrice * (1 - discount / 100));
}

export function getProductoId(producto) {
  return producto.id ?? producto.id_producto ?? "";
}

export function getStoredUser() {
  const storedUser = localStorage.getItem("user");
  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch (error) {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    return null;
  }
}

export function isAdminUser(user = getStoredUser()) {
  return Boolean(user && user.role === "admin");
}

export function getFriendlyRoleLabel(user = getStoredUser()) {
  if (!user?.role) {
    return "";
  }

  if (user.role === "admin") {
    return "administrador";
  }

  if (user.role === "client") {
    return "cliente";
  }

  return String(user.role).toLowerCase();
}

export function getAuthHeaders(extraHeaders = {}) {
  const token = localStorage.getItem("token");
  if (!token) {
    return extraHeaders;
  }

  return {
    ...extraHeaders,
    Authorization: `Bearer ${token}`,
  };
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await readResponse(response);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? data.error
        : "La solicitud no pudo completarse";
    throw new Error(message);
  }

  return data;
}

export async function loginUser(email, password) {
  const data = await apiRequest("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data.user;
}

export async function registerUser(payload) {
  const data = await apiRequest("/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return data;
}

export async function requestPasswordReset(email) {
  return apiRequest("/api/password-recovery/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword({ email, code, password }) {
  return apiRequest("/api/password-recovery/reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, code, password }),
  });
}

export function logoutSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export async function fetchCategorias({ includeHidden = false } = {}) {
  const headers = includeHidden ? getAuthHeaders() : {};

  return apiRequest("/api/categorias", {
    headers,
  });
}

export async function createCategoria(payload) {
  return apiRequest("/api/categorias", {
    method: "POST",
    headers: getAuthHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
}

export async function updateCategoria(categoryId, payload) {
  return apiRequest(`/api/categorias/${categoryId}`, {
    method: "PUT",
    headers: getAuthHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
}

export async function deleteCategoria(categoryId) {
  return apiRequest(`/api/categorias/${categoryId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
}

export async function fetchPublicProducts({ categoryId = "", page = 1, limit = 10 } = {}) {
  const endpoint = new URL("/api/productos", window.location.origin);

  if (categoryId) {
    endpoint.searchParams.set("id_categoria", categoryId);
  }

  endpoint.searchParams.set("page", page);
  endpoint.searchParams.set("limit", limit);

  const data = await apiRequest(endpoint);
  if (Array.isArray(data)) {
    return {
      productos: data,
      pagination: {
        page,
        limit,
        total: data.length,
        totalPages: 1,
      },
    };
  }

  return {
    productos: data.productos ?? [],
    pagination: data.pagination ?? {
      page,
      limit,
      total: data.productos?.length ?? 0,
      totalPages: 1,
    },
  };
}

export async function fetchAdminProducts({ page = 1, limit = 10 } = {}) {
  const endpoint = new URL("/api/admin/productos", window.location.origin);
  endpoint.searchParams.set("page", page);
  endpoint.searchParams.set("limit", limit);

  return apiRequest(endpoint, {
    headers: getAuthHeaders(),
  });
}

export async function fetchAdminUsers({ page = 1, limit = 10 } = {}) {
  const endpoint = new URL("/api/admin/usuarios", window.location.origin);
  endpoint.searchParams.set("page", page);
  endpoint.searchParams.set("limit", limit);

  return apiRequest(endpoint, {
    headers: getAuthHeaders(),
  });
}

export async function fetchCouponByCode(code) {
  const endpoint = new URL("/api/cupon/validar", window.location.origin);
  endpoint.searchParams.set("codigo", String(code ?? "").trim());

  return apiRequest(endpoint);
}

export async function checkoutCart(items, couponCode = "") {
  return apiRequest("/api/checkout", {
    method: "POST",
    headers: getAuthHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      items: Array.isArray(items) ? items : [],
      couponCode,
    }),
  });
}

export async function fetchMyOrders() {
  return apiRequest("/api/ordenes/mis-compras", {
    headers: getAuthHeaders(),
  });
}

export async function updateProduct(productId, payload) {
  return apiRequest(`/api/productos/${productId}`, {
    method: "PUT",
    headers: getAuthHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
}

export function broadcastProductChange(detail = {}) {
  const payload = {
    timestamp: Date.now(),
    ...detail,
  };

  if (syncChannel) {
    syncChannel.postMessage({ type: "products-changed", payload });
    return;
  }

  localStorage.setItem(STORAGE_SYNC_KEY, JSON.stringify(payload));
}

export function subscribeToProductChanges(handler) {
  const channelHandler = (event) => {
    if (event.data?.type === "products-changed") {
      handler(event.data.payload);
    }
  };

  const storageHandler = (event) => {
    if (event.key !== STORAGE_SYNC_KEY || !event.newValue) {
      return;
    }

    try {
      handler(JSON.parse(event.newValue));
    } catch (error) {
      // Ignoramos payloads corruptos y seguimos.
    }
  };

  if (syncChannel) {
    syncChannel.addEventListener("message", channelHandler);
  } else {
    window.addEventListener("storage", storageHandler);
  }

  return () => {
    if (syncChannel) {
      syncChannel.removeEventListener("message", channelHandler);
    } else {
      window.removeEventListener("storage", storageHandler);
    }
  };
}
