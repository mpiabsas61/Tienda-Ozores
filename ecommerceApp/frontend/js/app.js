import {
  calculateDiscountedPrice,
  escapeHtml,
  fetchCouponByCode,
  fetchCategorias,
  fetchPublicProducts,
  checkoutCart,
  formatArsCurrency,
  formatDiscountBadge,
  formatMoney,
  getFriendlyRoleLabel,
  getProductoId,
  getStoredUser,
  isAdminUser,
  logoutSession,
  broadcastProductChange,
  subscribeToProductChanges,
} from "./shared.js";

const CART_STORAGE_KEY = "neo-data-shop-cart";
const COUPON_STORAGE_KEY = "neo-data-shop-coupon";
const CATALOG_PAGE_SIZE = 10;
const CART_PAGE_SIZE = 10;

const appState = {
  activeCategoryId: "",
  pendingCategoryId: "",
  categories: [],
  currentProducts: [],
  currentPage: 1,
  totalPages: 1,
  totalProducts: 0,
  cartItems: [],
  cartPage: 1,
  cartTotalPages: 1,
  appliedCoupon: null,
};

let filterModalInstance = null;
let cartModalInstance = null;
let purchaseSuccessModalInstance = null;

function getCheckoutRequestedFlag() {
  return new URLSearchParams(window.location.search).get("checkout") === "1";
}

function clearCheckoutRequestedFlag() {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkout");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function loadCartState() {
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        const product = item?.product ?? item;
        const quantity = Math.max(1, Number(item?.quantity ?? 1) || 1);
        const stock = Number(product?.stock ?? 0);
        return {
          product: {
            id: String(getProductoId(product)),
            nombre: String(product?.nombre ?? ""),
            precio: Number(product?.precio ?? 0),
            stock,
            descuento: Boolean(product?.descuento),
            porcentajeDescuento: Number(product?.porcentajeDescuento ?? 0),
            image: String(product?.image ?? "https://via.placeholder.com/150"),
          },
          quantity: stock > 0 ? Math.min(quantity, stock) : quantity,
        };
      })
      .filter((item) => item.product.id);
  } catch (error) {
    localStorage.removeItem(CART_STORAGE_KEY);
    return [];
  }
}

function persistCartState() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(appState.cartItems));
}

function persistCouponState() {
  if (!appState.appliedCoupon?.code) {
    localStorage.removeItem(COUPON_STORAGE_KEY);
    return;
  }

  localStorage.setItem(
    COUPON_STORAGE_KEY,
    JSON.stringify({
      code: appState.appliedCoupon.code,
    }),
  );
}

function loadCouponState() {
  const raw = localStorage.getItem(COUPON_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const code = String(parsed?.code ?? "").trim();
    return code ? { code } : null;
  } catch (error) {
    localStorage.removeItem(COUPON_STORAGE_KEY);
    return null;
  }
}

function getCartItem(productId) {
  return appState.cartItems.find((item) => item.product.id === String(productId));
}

function getCartQuantity(productId) {
  return getCartItem(productId)?.quantity ?? 0;
}

function getCartUnitPrice(cartItem) {
  const product = cartItem.product;
  return calculateDiscountedPrice(
    product.precio,
    product.descuento ? product.porcentajeDescuento : 0,
  );
}

function getCartSubtotal() {
  return appState.cartItems.reduce((total, item) => {
    return total + getCartUnitPrice(item) * item.quantity;
  }, 0);
}

function getAppliedCouponDiscountPercentage() {
  const amount = Number(appState.appliedCoupon?.discountPercentage ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getAppliedCouponDiscountAmount() {
  const subtotal = getCartSubtotal();
  const discountPercentage = getAppliedCouponDiscountPercentage();
  if (!subtotal || !discountPercentage) {
    return 0;
  }

  return subtotal * (discountPercentage / 100);
}

function getCartTotal() {
  return Math.max(0, getCartSubtotal() - getAppliedCouponDiscountAmount());
}

function getCartUnits() {
  return appState.cartItems.reduce((total, item) => total + item.quantity, 0);
}

function updateCartCount() {
  const cartCount = document.getElementById("cart-count");
  if (cartCount) {
    cartCount.textContent = String(getCartUnits());
  }
}

function setCouponFeedback(message, tone = "muted") {
  const feedback = document.getElementById("coupon-feedback");
  if (!feedback) {
    return;
  }

  feedback.className = `small mt-2 text-${tone}`;
  feedback.textContent = message;
}

function syncCouponInputValue() {
  const input = document.getElementById("coupon-code-input");
  if (!input) {
    return;
  }

  input.value = appState.appliedCoupon?.code ?? "";
}

function updateCartModalSummary() {
  const subtotal = document.getElementById("cart-modal-subtotal");
  const total = document.getElementById("cart-modal-total");
  const discountLine = document.getElementById("cart-modal-discount-line");
  const couponLine = document.getElementById("cart-modal-coupon-line");

  const subtotalAmount = getCartSubtotal();
  const discountAmount = getAppliedCouponDiscountAmount();
  const totalAmount = getCartTotal();

  if (subtotal) {
    subtotal.textContent = formatArsCurrency(subtotalAmount);
  }

  if (total) {
    total.textContent = formatArsCurrency(totalAmount);
  }

  if (couponLine) {
    const couponCode = appState.appliedCoupon?.code ?? "";
    const discountPercentage = getAppliedCouponDiscountPercentage();
    couponLine.textContent = couponCode
      ? `Cupón aplicado: ${couponCode} (-${discountPercentage}%)`
      : "";
    couponLine.classList.toggle("d-none", !couponCode);
  }

  if (discountLine) {
    discountLine.textContent = discountAmount > 0 ? `Descuento cupón: -${formatArsCurrency(discountAmount)}` : "";
    discountLine.classList.toggle("d-none", discountAmount <= 0);
  }
}

function clearAppliedCoupon({ silent = false } = {}) {
  appState.appliedCoupon = null;
  persistCouponState();
  syncCouponInputValue();
  updateCartModalSummary();

  if (!silent) {
    setCouponFeedback("Cupón quitado.", "muted");
  }
}

function showPurchaseSuccessModal(result = {}) {
  const modalElement = document.getElementById("purchaseSuccessModal");
  const orderIdElement = document.getElementById("purchase-success-order-id");
  const subtotalElement = document.getElementById("purchase-success-subtotal");
  const discountElement = document.getElementById("purchase-success-discount");
  const discountRowElement = document.getElementById("purchase-success-discount-row");
  const totalElement = document.getElementById("purchase-success-total");
  const itemsListElement = document.getElementById("purchase-success-items-list");

  if (
    !modalElement ||
    !orderIdElement ||
    !subtotalElement ||
    !discountElement ||
    !discountRowElement ||
    !totalElement ||
    !itemsListElement
  ) {
    return;
  }

  const subtotal = Number(result?.subtotal ?? 0);
  const total = Number(result?.total ?? 0);
  const discount = Math.max(0, subtotal - total);
  const items = Array.isArray(result?.items) ? result.items : [];

  orderIdElement.textContent = result?.orderId ? `#${result.orderId}` : "—";
  subtotalElement.textContent = formatArsCurrency(subtotal);
  discountElement.textContent = discount > 0 ? `-${formatArsCurrency(discount)}` : "$0,00";
  discountRowElement.classList.toggle("d-none", discount <= 0);
  totalElement.textContent = formatArsCurrency(total);
  itemsListElement.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <li class="list-group-item px-0">
              <div class="d-flex justify-content-between align-items-center gap-3">
                <span>Producto #${item?.productId ?? "—"}</span>
                <span class="fw-semibold">x${item?.quantity ?? 0}</span>
              </div>
            </li>
          `,
        )
        .join("")
    : '<li class="list-group-item px-0 text-muted">No se registraron ítems adicionales.</li>';

  if (!purchaseSuccessModalInstance) {
    purchaseSuccessModalInstance = new bootstrap.Modal(modalElement);
  }

  purchaseSuccessModalInstance.show();
}

function getCheckoutPayloadItems() {
  return appState.cartItems.map((item) => ({
    productId: Number(item.product.id),
    quantity: Number(item.quantity ?? 0),
  }));
}

function resetCartAfterCheckout() {
  appState.cartItems = [];
  appState.cartPage = 1;
  persistCartState();
  updateCartCount();
  clearAppliedCoupon({ silent: true });
}

async function applyCouponCode(code, { silent = false, persist = true } = {}) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();

  if (!normalizedCode) {
    throw new Error("Escribí un código de cupón.");
  }

  const response = await fetchCouponByCode(normalizedCode);
  const discountPercentage = Number(response?.cupon?.descuentoPorcentaje ?? response?.cupon?.descuento ?? 0);

  if (!Number.isFinite(discountPercentage) || discountPercentage !== 10) {
    throw new Error("El cupón no tiene el 10% de descuento solicitado.");
  }

  appState.appliedCoupon = {
    code: String(response.cupon.nombre ?? normalizedCode).trim().toUpperCase(),
    discountPercentage,
    id: response.cupon.id_cupon,
  };

  if (persist) {
    persistCouponState();
  }

  syncCouponInputValue();
  updateCartModalSummary();

  if (!silent) {
    setCouponFeedback(`Cupón ${appState.appliedCoupon.code} aplicado correctamente.`, "success");
  }
}

async function restoreCouponState() {
  const stored = loadCouponState();
  if (!stored?.code) {
    return;
  }

  try {
    await applyCouponCode(stored.code, { silent: true, persist: true });
  } catch (error) {
    clearAppliedCoupon({ silent: true });
  }
}

async function finalizePurchase() {
  if (!appState.cartItems.length) {
    setCouponFeedback("El carrito está vacío.", "warning");
    return;
  }

  const user = getStoredUser();
  if (!user || !localStorage.getItem("token")) {
    window.location.replace("login.html?next=checkout");
    return;
  }

  const button = document.getElementById("finalize-purchase-button");
  const previousLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Procesando';

  try {
    const result = await checkoutCart(getCheckoutPayloadItems(), appState.appliedCoupon?.code ?? "");
    const purchasedCount = Array.isArray(result?.items) ? result.items.length : appState.cartItems.length;
    resetCartAfterCheckout();
    renderCartItems();
    updateCartModalSummary();
    cartModalInstance?.hide();
    await cargarCatalogo();
    broadcastProductChange({
      action: "checkout",
      purchasedCount,
    });
    showPurchaseSuccessModal(result);
    setCouponFeedback("", "muted");
  } catch (error) {
    updateCartModalSummary();
    setCouponFeedback(error.message || "No se pudo finalizar la compra.", "danger");
  } finally {
    button.disabled = false;
    button.innerHTML = previousLabel;
  }
}

function getActiveCategoryLabel() {
  if (!appState.activeCategoryId) {
    return "";
  }

  const category = appState.categories.find(
    (item) => String(item.id_categoria) === String(appState.activeCategoryId),
  );

  return category?.nombre ?? "la categoría seleccionada";
}

function renderActiveCategoryBanner() {
  const banner = document.getElementById("active-category-banner");
  if (!banner) {
    return;
  }

  if (!appState.activeCategoryId) {
    banner.textContent = "";
    banner.classList.add("d-none");
    return;
  }

  banner.textContent = `Mostrando artículos de la categoría: ${getActiveCategoryLabel()}`;
  banner.classList.remove("d-none");
}

function updateInlineClearFilterButton() {
  const button = document.getElementById("clear-filter-inline-button");
  if (!button) {
    return;
  }

  button.classList.toggle("d-none", !appState.activeCategoryId);
}

function renderCatalogPagination() {
  const container = document.getElementById("catalog-pagination");
  if (!container) {
    return;
  }

  if (appState.totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const pages = Array.from({ length: appState.totalPages }, (_, index) => index + 1);

  container.innerHTML = `
    <li class="page-item ${appState.currentPage <= 1 ? "disabled" : ""}">
      <button class="page-link" type="button" data-page="${appState.currentPage - 1}" ${appState.currentPage <= 1 ? "disabled" : ""}>
        Anterior
      </button>
    </li>
    ${pages
      .map(
        (page) => `
          <li class="page-item ${page === appState.currentPage ? "active" : ""}">
            <button class="page-link" type="button" data-page="${page}" ${page === appState.currentPage ? 'aria-current="page"' : ""}>
              ${page}
            </button>
          </li>
        `,
      )
      .join("")}
    <li class="page-item ${appState.currentPage >= appState.totalPages ? "disabled" : ""}">
      <button class="page-link" type="button" data-page="${appState.currentPage + 1}" ${appState.currentPage >= appState.totalPages ? "disabled" : ""}>
        Siguiente
      </button>
    </li>
  `;
}

function renderCartPagination() {
  const container = document.getElementById("cart-pagination");
  if (!container) {
    return;
  }

  if (appState.cartTotalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const pages = Array.from({ length: appState.cartTotalPages }, (_, index) => index + 1);

  container.innerHTML = `
    <li class="page-item ${appState.cartPage <= 1 ? "disabled" : ""}">
      <button class="page-link" type="button" data-cart-page="${appState.cartPage - 1}" ${appState.cartPage <= 1 ? "disabled" : ""}>
        Anterior
      </button>
    </li>
    ${pages
      .map(
        (page) => `
          <li class="page-item ${page === appState.cartPage ? "active" : ""}">
            <button class="page-link" type="button" data-cart-page="${page}" ${page === appState.cartPage ? 'aria-current="page"' : ""}>
              ${page}
            </button>
          </li>
        `,
      )
      .join("")}
    <li class="page-item ${appState.cartPage >= appState.cartTotalPages ? "disabled" : ""}">
      <button class="page-link" type="button" data-cart-page="${appState.cartPage + 1}" ${appState.cartPage >= appState.cartTotalPages ? "disabled" : ""}>
        Siguiente
      </button>
    </li>
  `;
}

function renderProductCard(producto) {
  const container = document.getElementById("catalogo");
  const productoId = String(getProductoId(producto));
  const nombre = escapeHtml(producto.nombre ?? "");
  const stock = Number(producto.stock ?? 0);
  const cartQuantity = getCartQuantity(productoId);
  const precioOriginal = Number(producto.precio ?? 0);
  const porcentajeDescuento = Number(producto.porcentajeDescuento ?? 0);
  const precioConDescuento = calculateDiscountedPrice(
    precioOriginal,
    producto.descuento ? porcentajeDescuento : 0,
  );
  const tieneDescuento = producto.descuento && porcentajeDescuento > 0;
  const image = escapeHtml(producto.image ?? "https://via.placeholder.com/150");
  const discountLabel = tieneDescuento ? formatDiscountBadge(porcentajeDescuento) : "";
  const canAddMore = stock > 0 && cartQuantity < stock;
  const addLabel = stock === 0 ? "Agotado" : canAddMore ? "Agregar al carrito" : "Sin stock";

  const priceMarkup = tieneDescuento
    ? `
      <div class="d-flex flex-column align-items-end">
        <span class="small text-muted text-decoration-line-through">$${formatMoney(precioOriginal)}</span>
        <span class="h5 mb-0 text-primary fw-bold">$${formatMoney(precioConDescuento)}</span>
      </div>
    `
    : `<span class="h5 mb-0 text-primary fw-bold">$${formatMoney(precioOriginal)}</span>`;

  const colDiv = document.createElement("div");
  colDiv.classList.add("col-12", "col-sm-6", "col-md-4", "col-lg-3");

  colDiv.innerHTML = `
    <div class="card h-100 shadow-sm border-0 transition-card">
      <div class="position-relative overflow-hidden" style="height: 250px; background: #f8f9fa;">
        <img src="${image}" class="card-img-top w-100 h-100 object-fit-cover" alt="${nombre}">
        ${discountLabel ? `<span class="badge bg-danger text-white position-absolute top-0 start-0 m-2">${discountLabel}</span>` : ""}
        ${stock <= 10 ? '<span class="badge bg-warning position-absolute top-0 end-0 m-2">Últimas unidades</span>' : ""}
      </div>
      <div class="card-body d-flex flex-column">
        <h6 class="card-title fw-bold text-truncate" title="${nombre}">${nombre}</h6>
        <p class="card-text text-muted small mb-3" style="flex-grow: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
          Stock disponible: ${stock} unidades
        </p>
        <div class="mb-3">
          <div class="d-flex align-items-center justify-content-between">
            ${priceMarkup}
          </div>
        </div>
      </div>
      <div class="card-footer bg-white border-top-0">
        <button
          class="btn btn-primary w-100 btn-sm fw-bold"
          type="button"
          data-cart-action="add"
          data-product-id="${productoId}"
          ${canAddMore ? "" : "disabled"}
        >
          <i class="bi bi-cart-plus"></i> ${addLabel}
        </button>
      </div>
    </div>
  `;

  container.appendChild(colDiv);
}

function renderCatalogProducts(productos = []) {
  const container = document.getElementById("catalogo");
  if (!container) {
    return;
  }

  appState.currentProducts = productos;
  container.innerHTML = "";

  productos.forEach(renderProductCard);
  renderCatalogPagination();
  updateCartCount();
}

function renderCategoryFilterOptions() {
  const container = document.getElementById("category-filter-options");
  if (!container) {
    return;
  }

  const options = appState.categories.map((category) => ({
      value: String(category.id_categoria),
      label: category.nombre,
    }));

  container.innerHTML = options
    .map((option, index) => {
      const id = `filter-option-${index}`;
      const checked = String(appState.pendingCategoryId ?? "") === String(option.value ?? "");

      return `
        <div class="d-inline-flex">
          <input
            type="radio"
            class="btn-check"
            name="category-filter-option"
            id="${id}"
            value="${escapeHtml(option.value)}"
            ${checked ? "checked" : ""}
          />
          <label class="btn btn-outline-primary btn-sm d-inline-flex align-items-center" for="${id}">
            ${escapeHtml(option.label)}
          </label>
        </div>
      `;
    })
    .join("");
}

function renderCartItems() {
  const list = document.getElementById("cart-items-list");
  const emptyState = document.getElementById("cart-empty-state");
  if (!list || !emptyState) {
    return;
  }

  if (!appState.cartItems.length) {
    emptyState.classList.remove("d-none");
    list.innerHTML = "";
    appState.cartTotalPages = 1;
    renderCartPagination();
    updateCartModalSummary();
    return;
  }

  emptyState.classList.add("d-none");
  appState.cartTotalPages = Math.max(1, Math.ceil(appState.cartItems.length / CART_PAGE_SIZE));
  if (appState.cartPage > appState.cartTotalPages) {
    appState.cartPage = appState.cartTotalPages;
  }

  const start = (appState.cartPage - 1) * CART_PAGE_SIZE;
  const items = appState.cartItems.slice(start, start + CART_PAGE_SIZE);

  list.innerHTML = items
    .map((item) => {
      const product = item.product;
      const quantity = item.quantity;
      const unitPrice = getCartUnitPrice(item);
      const subtotal = unitPrice * quantity;
      const image = escapeHtml(product.image);
      const nombre = escapeHtml(product.nombre);
      const originalPrice = Number(product.precio ?? 0);
      const unitMarkup =
        product.descuento && Number(product.porcentajeDescuento ?? 0) > 0
          ? `
            <span class="text-muted text-decoration-line-through me-2">${formatArsCurrency(originalPrice)}</span>
            <span class="text-danger fw-semibold">${formatArsCurrency(unitPrice)}</span>
          `
          : `<span class="fw-semibold">${formatArsCurrency(unitPrice)}</span>`;

      return `
        <div class="cart-item-row">
          <div class="d-flex gap-3 align-items-start">
            <img src="${image}" alt="${nombre}" class="cart-item-image">
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex flex-column flex-sm-row justify-content-between gap-2">
                <div class="min-w-0">
                  <div class="cart-item-name cart-item-title">${nombre}</div>
                  <div class="cart-item-meta">${unitMarkup}</div>
                </div>
                <div class="text-sm-end">
                  <div class="fw-semibold">${formatArsCurrency(subtotal)}</div>
                  <div class="cart-item-meta">Cantidad: ${quantity}</div>
                </div>
              </div>
              <div class="cart-item-controls d-flex flex-wrap gap-2 mt-3">
                <button id="btn-decrement-${product.id}" type="button" class="btn btn-outline-secondary btn-sm" data-cart-action="decrement" data-product-id="${product.id}" aria-label="Disminuir cantidad de ${nombre}">
                  <i class="bi bi-dash"></i> 1
                </button>
                <button id="btn-increment-${product.id}" type="button" class="btn btn-outline-secondary btn-sm" data-cart-action="increment" data-product-id="${product.id}" aria-label="Aumentar cantidad de ${nombre}" ${quantity >= Number(product.stock ?? 0) ? "disabled" : ""}>
                  <i class="bi bi-plus"></i> 1
                </button>
                <button id="btn-remove-all-${product.id}" type="button" class="btn btn-outline-danger btn-sm" data-cart-action="remove-all" data-product-id="${product.id}">
                  <i class="bi bi-trash"></i> Quitar todo
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  renderCartPagination();
  updateCartModalSummary();
}

function openCartModal() {
  if (!cartModalInstance) {
    cartModalInstance = new bootstrap.Modal(document.getElementById("cartModal"));
  }

  appState.cartPage = 1;
  syncCouponInputValue();
  if (appState.appliedCoupon?.code) {
    setCouponFeedback(
      `Cupón ${appState.appliedCoupon.code} aplicado correctamente.`,
      "success",
    );
  } else {
    setCouponFeedback("", "muted");
  }
  renderCartItems();
  cartModalInstance.show();
}

function addToCart(productId) {
  const product = appState.currentProducts.find((item) => String(getProductoId(item)) === String(productId));
  if (!product) {
    return;
  }

  const existing = getCartItem(productId);
  const stock = Number(product.stock ?? 0);

  if (existing) {
    if (existing.quantity >= stock) {
      return;
    }
    existing.quantity += 1;
  } else {
    appState.cartItems.push({
      product: {
        id: String(productId),
        nombre: String(product.nombre ?? ""),
        precio: Number(product.precio ?? 0),
        stock,
        descuento: Boolean(product.descuento),
        porcentajeDescuento: Number(product.porcentajeDescuento ?? 0),
        image: String(product.image ?? "https://via.placeholder.com/150"),
      },
      quantity: 1,
    });
  }

  persistCartState();
  updateCartCount();
  renderCatalogProducts(appState.currentProducts);
  if (document.getElementById("cartModal")?.classList.contains("show")) {
    renderCartItems();
  }
}

function incrementCartItem(productId) {
  const item = getCartItem(productId);
  if (!item || item.quantity >= Number(item.product.stock ?? 0)) {
    return;
  }

  item.quantity += 1;
  persistCartState();
  updateCartCount();
  renderCatalogProducts(appState.currentProducts);
  renderCartItems();
}

function decrementCartItem(productId) {
  const index = appState.cartItems.findIndex((item) => item.product.id === String(productId));
  if (index === -1) {
    return;
  }

  if (appState.cartItems[index].quantity <= 1) {
    appState.cartItems.splice(index, 1);
  } else {
    appState.cartItems[index].quantity -= 1;
  }

  persistCartState();
  updateCartCount();
  renderCatalogProducts(appState.currentProducts);
  renderCartItems();
}

function removeAllCartItem(productId) {
  const before = appState.cartItems.length;
  appState.cartItems = appState.cartItems.filter((item) => item.product.id !== String(productId));
  if (appState.cartItems.length === before) {
    return;
  }

  persistCartState();
  updateCartCount();
  renderCatalogProducts(appState.currentProducts);
  renderCartItems();
}

function openFilterModal() {
  appState.pendingCategoryId = appState.activeCategoryId;
  renderCategoryFilterOptions();

  if (!filterModalInstance) {
    filterModalInstance = new bootstrap.Modal(document.getElementById("filterModal"));
  }

  filterModalInstance.show();
}

function applyActiveCategoryBanner() {
  renderActiveCategoryBanner();
  updateInlineClearFilterButton();
}

async function applyFilterSelection(categoryId) {
  appState.activeCategoryId = categoryId;
  appState.pendingCategoryId = categoryId;
  appState.currentPage = 1;
  applyActiveCategoryBanner();
  await cargarCatalogo();
}

async function cargarCategorias() {
  try {
    appState.categories = await fetchCategorias();

    const activeCategoryExists = appState.categories.some(
      (item) => String(item.id_categoria) === String(appState.activeCategoryId),
    );
    const categoryWasCleared = Boolean(appState.activeCategoryId) && !activeCategoryExists;

    if (categoryWasCleared) {
      appState.activeCategoryId = "";
      appState.pendingCategoryId = "";
    }

    renderCategoryFilterOptions();
    renderActiveCategoryBanner();
    updateInlineClearFilterButton();

    if (categoryWasCleared) {
      await cargarCatalogo();
    }

    return categoryWasCleared;
  } catch (error) {
    console.error("Error al cargar las categorías:", error);
    return false;
  }
}

async function cargarCatalogo() {
  const container = document.getElementById("catalogo");
  const paginationContainer = document.getElementById("catalog-pagination");
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="col-12">
      <div class="alert alert-light border text-center mb-0">
        Cargando productos...
      </div>
    </div>
  `;
  if (paginationContainer) {
    paginationContainer.innerHTML = "";
  }

  try {
    const { productos, pagination } = await fetchPublicProducts({
      categoryId: appState.activeCategoryId,
      page: appState.currentPage,
      limit: CATALOG_PAGE_SIZE,
    });

    appState.totalPages = Number(pagination?.totalPages) || 1;
    appState.totalProducts = Number(pagination?.total) || productos.length;
    appState.currentPage = Number(pagination?.page) || appState.currentPage;

    if (!productos.length) {
      const emptyMessage = appState.activeCategoryId
        ? "No hay productos para la categoría seleccionada."
        : "No hay productos disponibles.";
      container.innerHTML = `
        <div class="col-12">
          <div class="alert alert-light border text-center mb-0">
            ${emptyMessage}
          </div>
        </div>
      `;
      renderCatalogPagination();
      return;
    }

    renderCatalogProducts(productos);
  } catch (error) {
    console.error("Error al cargar los productos:", error);
    container.innerHTML = `
      <div class="col-12">
        <div class="alert alert-danger text-center mb-0">
          No se pudieron cargar los productos.
        </div>
      </div>
    `;
  }
}

async function renderUI() {
  const user = getStoredUser();
  const catalogSection = document.getElementById("catalog-section");
  const sessionStatus = document.getElementById("session-status");
  const logoutButton = document.getElementById("logout-button");
  const adminLink = document.getElementById("admin-link");
  const loginLink = document.getElementById("login-link");
  const registerLink = document.getElementById("register-link");
  const profileLink = document.getElementById("profile-link");

  catalogSection.classList.remove("d-none");
  if (user) {
    logoutButton.classList.remove("d-none");
    loginLink.classList.add("d-none");
    registerLink.classList.add("d-none");
    profileLink.classList.remove("d-none");
    const roleLabel = getFriendlyRoleLabel(user);
    sessionStatus.textContent = roleLabel ? `Conectado como ${roleLabel}` : "Conectado";

    if (isAdminUser(user)) {
      adminLink.classList.remove("d-none");
    } else {
      adminLink.classList.add("d-none");
    }
  } else {
    logoutButton.classList.add("d-none");
    loginLink.classList.remove("d-none");
    registerLink.classList.remove("d-none");
    profileLink.classList.add("d-none");
    adminLink.classList.add("d-none");
    sessionStatus.textContent = "Modo invitado";
  }

  const catalogWasRefreshedByCategoryLoad = await cargarCategorias();
  if (!catalogWasRefreshedByCategoryLoad) {
    await cargarCatalogo();
  }

  await restoreCouponState();
  updateCartModalSummary();

  if (user && getCheckoutRequestedFlag()) {
    clearCheckoutRequestedFlag();
    await finalizePurchase();
  }
}

function handleLogout() {
  logoutSession();
  window.location.replace("login.html");
}

document.getElementById("logout-button").addEventListener("click", handleLogout);
document.getElementById("filter-button").addEventListener("click", openFilterModal);
document.getElementById("clear-filter-inline-button").addEventListener("click", async () => {
  await applyFilterSelection("");
});
document.getElementById("cart-button").addEventListener("click", openCartModal);

document.getElementById("apply-coupon-button").addEventListener("click", async () => {
  const input = document.getElementById("coupon-code-input");
  const code = String(input?.value ?? "").trim();

  if (!code) {
    setCouponFeedback("Escribí un código de cupón.", "warning");
    return;
  }

  const button = document.getElementById("apply-coupon-button");
  const previousLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Validando';

  try {
    await applyCouponCode(code);
  } catch (error) {
    updateCartModalSummary();
    setCouponFeedback(error.message || "No se pudo validar el cupón.", "danger");
  } finally {
    button.disabled = false;
    button.innerHTML = previousLabel;
  }
});

document.getElementById("clear-coupon-button").addEventListener("click", () => {
  clearAppliedCoupon();
});

document.getElementById("coupon-code-input").addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    document.getElementById("apply-coupon-button").click();
  }
});

document.getElementById("finalize-purchase-button").addEventListener("click", async () => {
  await finalizePurchase();
});

document.getElementById("apply-filter-button").addEventListener("click", async () => {
  const selected = document.querySelector('input[name="category-filter-option"]:checked');
  const selectedCategoryId = selected?.value ?? "";
  await applyFilterSelection(selectedCategoryId);
  filterModalInstance.hide();
});

document.getElementById("catalogo").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-cart-action][data-product-id]");
  if (!button || button.disabled) {
    return;
  }

  const productId = button.dataset.productId;
  const action = button.dataset.cartAction;

  if (action === "add") {
    addToCart(productId);
  }
});

document.getElementById("catalog-pagination").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-page]");
  if (!button || button.disabled) {
    return;
  }

  const nextPage = Number(button.dataset.page);
  if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage === appState.currentPage) {
    return;
  }

  appState.currentPage = nextPage;
  await cargarCatalogo();
});

document.getElementById("cart-pagination").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-cart-page]");
  if (!button || button.disabled) {
    return;
  }

  const nextPage = Number(button.dataset.cartPage);
  if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage === appState.cartPage) {
    return;
  }

  appState.cartPage = nextPage;
  renderCartItems();
});

document.getElementById("cart-items-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-cart-action][data-product-id]");
  if (!button) {
    return;
  }

  const productId = button.dataset.productId;
  const action = button.dataset.cartAction;

  if (action === "increment") {
    incrementCartItem(productId);
  }

  if (action === "decrement") {
    decrementCartItem(productId);
  }

  if (action === "remove-all") {
    removeAllCartItem(productId);
  }
});

subscribeToProductChanges(async () => {
  const user = getStoredUser();
  if (!user) {
    return;
  }

  const catalogWasRefreshedByCategoryLoad = await cargarCategorias();
  if (!catalogWasRefreshedByCategoryLoad) {
    await cargarCatalogo();
  }
  if (document.getElementById("cartModal")?.classList.contains("show")) {
    renderCartItems();
  }
});

appState.cartItems = loadCartState();
updateCartCount();
renderUI();
