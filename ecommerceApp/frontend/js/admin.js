import {
  broadcastProductChange,
  createCategoria,
  deleteCategoria,
  escapeHtml,
  fetchCategorias,
  fetchAdminProducts,
  fetchAdminUsers,
  formatArsCurrency,
  formatDecimalInput,
  formatDiscountPercentage,
  getFriendlyRoleLabel,
  getAuthHeaders,
  getProductoId,
  getStoredUser,
  isAdminUser,
  logoutSession,
  subscribeToProductChanges,
  updateCategoria,
  updateProduct,
} from "./shared.js";

const ADMIN_PAGE_SIZE = 10;
const ADMIN_FETCH_LIMIT = 1000;

const state = {
  activeView: "products",
  productPage: 1,
  productTotalPages: 1,
  productTotalItems: 0,
  userPage: 1,
  userTotalPages: 1,
  allProducts: [],
  productFilters: {
    id: "",
    title: "",
    categoryId: "",
    priceMin: "",
    priceMax: "",
    stockMin: "",
    stockMax: "",
    image: "",
    discount: "",
    visible: "",
  },
  categories: [],
  pendingDelete: null,
  originalProducts: new Map(),
  productDrafts: new Map(),
  originalCategories: new Map(),
  saving: false,
  creatingCategory: false,
};

let deleteModalInstance = null;

function setMessage(message, tone = "muted") {
  const messageBox = document.getElementById("admin-message");
  if (!messageBox) {
    return;
  }

  messageBox.className = `small mb-3 text-${tone}`;
  messageBox.textContent = message;
}

function setGuardMessage(message) {
  const guard = document.getElementById("admin-guard");
  const paragraph = guard?.querySelector("p");
  if (paragraph) {
    paragraph.textContent = message;
  }
}

function getProductSnapshot(product) {
  return {
    nombre: String(product.nombre ?? "").trim(),
    id_categoria: Number(product.id_categoria ?? 0),
    precio: Number(product.precio ?? 0),
    stock: Number(product.stock ?? 0),
    image: String(product.image ?? "").trim(),
    descuento: product.descuento === true,
    porcentajeDescuento: Number(product.porcentajeDescuento ?? 0),
    visible: product.visible !== false,
  };
}

function normalizeProductRowData(row) {
  const descuento = row.querySelector('[data-field="descuento"]').value === "true";
  const porcentajeDescuentoInput = row.querySelector('[data-field="porcentajeDescuento"]');
  const porcentajeDescuento = descuento ? Number(porcentajeDescuentoInput.value) : 0;

  return {
    nombre: row.querySelector('[data-field="nombre"]').value.trim(),
    id_categoria: Number(row.querySelector('[data-field="id_categoria"]').value),
    precio: Number(row.querySelector('[data-field="precio"]').value),
    stock: Number.parseInt(row.querySelector('[data-field="stock"]').value, 10),
    image: row.querySelector('[data-field="image"]').value.trim(),
    descuento,
    porcentajeDescuento,
    visible: row.querySelector('[data-field="visible"]').value === "true",
  };
}

function getCategorySnapshot(category) {
  return {
    nombre: String(category.nombre ?? "").trim(),
    visible: category.visible !== false,
  };
}

function normalizeCategoryRowData(row) {
  return {
    nombre: row.querySelector('[data-field="nombre"]').value.trim(),
    visible: row.querySelector('[data-field="visible"]').value === "true",
  };
}

function updateViewButtons() {
  for (const view of ["products", "categories", "users"]) {
    const button = document.getElementById(`${view}-view-button`);
    if (!button) {
      continue;
    }

    const isActive = state.activeView === view;
    button.classList.toggle("btn-primary", isActive);
    button.classList.toggle("btn-outline-primary", !isActive);
  }
}

function updateVisibleSections() {
  const productsSection = document.getElementById("admin-products-section");
  const categoriesSection = document.getElementById("admin-categories-section");
  const usersSection = document.getElementById("admin-users-section");

  if (productsSection) {
    productsSection.classList.toggle("d-none", state.activeView !== "products");
  }

  if (categoriesSection) {
    categoriesSection.classList.toggle("d-none", state.activeView !== "categories");
  }

  if (usersSection) {
    usersSection.classList.toggle("d-none", state.activeView !== "users");
  }
}

function getDirtyRowsSelector() {
  if (state.activeView === "products") {
    return '#admin-products-body tr[data-product-id][data-dirty="true"]';
  }

  if (state.activeView === "categories") {
    return '#admin-categories-body tr[data-category-id][data-dirty="true"]';
  }

  return "#admin-users-body tr[data-dirty='true']";
}

function updateSaveButtonState() {
  const button = document.getElementById("save-changes-button");
  if (!button) {
    return;
  }

  const dirtyRows = document.querySelectorAll(getDirtyRowsSelector()).length;
  const labels = {
    products: "Guardar cambios",
    categories: "Guardar categorías",
    users: "Guardar cambios",
  };

  button.disabled = state.activeView === "users" || state.saving || dirtyRows === 0;
  button.innerHTML = `<i class="bi bi-save"></i> ${labels[state.activeView]}${dirtyRows > 0 ? ` (${dirtyRows})` : ""}`;
}

function updateProductFilterInputs() {
  const fields = {
    "filter-product-id": state.productFilters.id,
    "filter-product-title": state.productFilters.title,
    "filter-product-category": state.productFilters.categoryId,
    "filter-product-price-min": state.productFilters.priceMin,
    "filter-product-price-max": state.productFilters.priceMax,
    "filter-product-stock-min": state.productFilters.stockMin,
    "filter-product-stock-max": state.productFilters.stockMax,
    "filter-product-image": state.productFilters.image,
    "filter-product-discount": state.productFilters.discount,
    "filter-product-visible": state.productFilters.visible,
  };

  for (const [id, value] of Object.entries(fields)) {
    const input = document.getElementById(id);
    if (input) {
      input.value = value;
    }
  }
}

function readProductFiltersFromInputs() {
  return {
    id: document.getElementById("filter-product-id")?.value?.trim() ?? "",
    title: document.getElementById("filter-product-title")?.value?.trim() ?? "",
    categoryId: document.getElementById("filter-product-category")?.value?.trim() ?? "",
    priceMin: document.getElementById("filter-product-price-min")?.value?.trim() ?? "",
    priceMax: document.getElementById("filter-product-price-max")?.value?.trim() ?? "",
    stockMin: document.getElementById("filter-product-stock-min")?.value?.trim() ?? "",
    stockMax: document.getElementById("filter-product-stock-max")?.value?.trim() ?? "",
    image: document.getElementById("filter-product-image")?.value?.trim() ?? "",
    discount: document.getElementById("filter-product-discount")?.value?.trim() ?? "",
    visible: document.getElementById("filter-product-visible")?.value?.trim() ?? "",
  };
}

function renderProductCategoryFilterOptions() {
  const select = document.getElementById("filter-product-category");
  if (!select) {
    return;
  }

  const selected = state.productFilters.categoryId;
  select.innerHTML = `
    <option value="">Todas</option>
    ${state.categories
      .map((category) => {
        const value = String(category.id_categoria ?? "");
        const isSelected = value === String(selected) ? "selected" : "";
        return `<option value="${escapeHtml(value)}" ${isSelected}>${escapeHtml(category.nombre ?? `Categoría ${value}`)}</option>`;
      })
      .join("")}
  `;
}

function applyProductFilterState(page = 1) {
  state.productFilters = readProductFiltersFromInputs();
  applyProductSearch(page);
}

function clearProductFilters() {
  state.productFilters = {
    id: "",
    title: "",
    categoryId: "",
    priceMin: "",
    priceMax: "",
    stockMin: "",
    stockMax: "",
    image: "",
    discount: "",
    visible: "",
  };
  updateProductFilterInputs();
  renderProductCategoryFilterOptions();
  applyProductSearch(1);
}

function getExportFileName(prefix) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `${prefix}_${dateStamp}.xlsx`;
}

function getFilteredProducts() {
  const filters = state.productFilters;
  return state.allProducts.filter((producto) => {
    const id = Number(getProductoId(producto));
    const nombre = String(producto.nombre ?? "").toLowerCase();
    const precio = Number(producto.precio ?? 0);
    const stock = Number(producto.stock ?? 0);
    const image = String(producto.image ?? "").toLowerCase();
    const descuento = Boolean(producto.descuento);
    const visible = producto.visible !== false;

    if (filters.id && String(id) !== String(filters.id)) {
      return false;
    }

    if (filters.title && !nombre.includes(String(filters.title).trim().toLowerCase())) {
      return false;
    }

    if (filters.categoryId && String(producto.id_categoria ?? "") !== String(filters.categoryId)) {
      return false;
    }

    if (filters.priceMin !== "" && precio < Number(filters.priceMin)) {
      return false;
    }

    if (filters.priceMax !== "" && precio > Number(filters.priceMax)) {
      return false;
    }

    if (filters.stockMin !== "" && stock < Number(filters.stockMin)) {
      return false;
    }

    if (filters.stockMax !== "" && stock > Number(filters.stockMax)) {
      return false;
    }

    if (filters.image && !image.includes(String(filters.image).trim().toLowerCase())) {
      return false;
    }

    if (filters.discount !== "" && String(descuento) !== String(filters.discount)) {
      return false;
    }

    if (filters.visible !== "" && String(visible) !== String(filters.visible)) {
      return false;
    }

    return true;
  });
}

function buildProductExportRows(products) {
  return products.map((producto) => {
    const productId = getProductoId(producto);
    const categoryId = Number(producto.id_categoria ?? 0);
    const categoryName =
      state.categories.find((item) => String(item.id_categoria) === String(categoryId))?.nombre ??
      producto.categoria?.nombre ??
      `Categoría #${categoryId || "?"}`;

    return {
      ID: productId,
      Título: String(producto.nombre ?? ""),
      Categoría: String(categoryName),
      "ID categoría": Number.isFinite(categoryId) && categoryId > 0 ? categoryId : "",
      Precio: Number(producto.precio ?? 0),
      Stock: Number(producto.stock ?? 0),
      Imagen: String(producto.image ?? ""),
      Descuento: producto.descuento === true ? "Activo" : "Inactivo",
      "% Descuento": producto.descuento === true ? Number(producto.porcentajeDescuento ?? 0) : 0,
      Visibilidad: producto.visible !== false ? "Visible" : "Oculto",
    };
  });
}

async function exportProductsToXlsx() {
  if (state.activeView !== "products") {
    setMessage("La exportación solo está disponible en publicaciones.", "warning");
    return;
  }

  if (typeof XLSX === "undefined") {
    setMessage("No se pudo cargar la librería necesaria para exportar a Excel.", "danger");
    return;
  }

  state.productFilters = readProductFiltersFromInputs();
  const filteredProducts = getFilteredProducts();

  if (!filteredProducts.length) {
    setMessage("No hay publicaciones para exportar con los filtros actuales.", "warning");
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(buildProductExportRows(filteredProducts));
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 30 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 48 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Productos");
  XLSX.writeFile(workbook, getExportFileName("productos_admin"));

  setMessage(`Se exportaron ${filteredProducts.length} publicaciones a Excel.`, "success");
}

function renderProductPagination(totalItems) {
  const pagination = document.getElementById("admin-pagination");
  if (!pagination) {
    return;
  }

  if (state.activeView !== "products" || state.productTotalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  const pageItems = [];

  const makePageItem = ({ label, page, active = false, disabled = false, icon = "" }) => `
    <li class="page-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}">
      <button
        type="button"
        class="page-link"
        data-page="${page}"
        ${disabled ? "disabled" : ""}
        ${active ? 'aria-current="page"' : ""}
      >
        ${icon ? `<i class="bi ${icon}"></i> ` : ""}
        ${label}
      </button>
    </li>
  `;

  pageItems.push(
    makePageItem({
      label: "Anterior",
      page: state.productPage - 1,
      disabled: state.productPage === 1,
      icon: "bi-chevron-left",
    }),
  );

  for (let page = 1; page <= state.productTotalPages; page += 1) {
    pageItems.push(
      makePageItem({
        label: page,
        page,
        active: page === state.productPage,
      }),
    );
  }

  pageItems.push(
    makePageItem({
      label: "Siguiente",
      page: state.productPage + 1,
      disabled: state.productPage === state.productTotalPages,
      icon: "bi-chevron-right",
    }),
  );

  pagination.innerHTML = pageItems.join("");
}

function renderCategoryOptions(selectedCategoryId) {
  if (!state.categories.length) {
    return `
      <option value="${escapeHtml(String(selectedCategoryId ?? ""))}" selected>
        Sin categorías disponibles
      </option>
    `;
  }

  const selectedValue = String(selectedCategoryId ?? "");

  return state.categories
    .map((category) => {
      const value = String(category.id_categoria ?? "");
      const selected = value === selectedValue ? "selected" : "";
      const label = escapeHtml(category.nombre ?? `Categoría ${value}`);

      return `<option value="${escapeHtml(value)}" ${selected}>${label}</option>`;
    })
    .join("");
}

function setPricePreview(row) {
  const input = row.querySelector('[data-field="precio"]');
  const label = row.querySelector('[data-field="price-label"]');
  const value = Number(input.value);
  label.textContent = `Precio ARS: ${formatArsCurrency(value)}`;
}

function setDiscountPreview(row) {
  const select = row.querySelector('[data-field="descuento"]');
  const input = row.querySelector('[data-field="porcentajeDescuento"]');
  const label = row.querySelector('[data-field="discount-label"]');
  const enabled = select.value === "true";
  input.disabled = !enabled;

  if (!enabled) {
    input.value = 0;
    label.textContent = "";
    return;
  }

  const parsed = Number(input.value);
  label.textContent = Number.isFinite(parsed) && parsed > 0 ? formatDiscountPercentage(parsed) : "";
}

function renderProductRows(productos) {
  const body = document.getElementById("admin-products-body");
  state.originalProducts.clear();

  if (!productos.length) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-muted">
          No hay productos para mostrar.
        </td>
      </tr>
    `;
    updateSaveButtonState();
    return;
  }

  body.innerHTML = productos
    .map((producto) => {
      const id = getProductoId(producto);
      const snapshot = getProductSnapshot(producto);
      state.originalProducts.set(String(id), snapshot);

      const draft = state.productDrafts.get(String(id));
      const sourceProduct = draft ? { ...producto, ...draft } : producto;
      const nombre = escapeHtml(sourceProduct.nombre ?? "");
      const precio = formatDecimalInput(sourceProduct.precio);
      const stock = Number(sourceProduct.stock ?? 0);
      const image = escapeHtml(sourceProduct.image ?? "");
      const idCategoria = Number(sourceProduct.id_categoria ?? 0);
      const categoriaNombre = escapeHtml(
        state.categories.find((item) => String(item.id_categoria) === String(idCategoria))?.nombre ??
          producto.categoria?.nombre ??
          `Categoría #${idCategoria || "?"}`,
      );
      const descuento = sourceProduct.descuento === true;
      const porcentajeDescuento = Number(sourceProduct.porcentajeDescuento ?? 0);
      const visible = sourceProduct.visible !== false;
      const discountLabel = descuento ? formatDiscountPercentage(porcentajeDescuento) : "";

      return `
        <tr data-product-id="${id}" data-dirty="false">
          <td class="text-muted">${id}</td>
          <td>
            <input
              type="text"
              class="form-control form-control-sm admin-field"
              data-field="nombre"
              value="${nombre}"
            >
          </td>
          <td>
            <select class="form-select form-select-sm admin-field" data-field="id_categoria">
              ${renderCategoryOptions(idCategoria)}
            </select>
            <div class="small text-muted mt-1">${categoriaNombre}</div>
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="0.01"
              class="form-control form-control-sm admin-field admin-price-field"
              data-field="precio"
              value="${precio}"
            >
            <div class="small text-muted mt-1" data-field="price-label"></div>
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="1"
              class="form-control form-control-sm admin-field admin-stock-field"
              data-field="stock"
              value="${stock}"
            >
          </td>
          <td>
            <input
              type="url"
              class="form-control form-control-sm admin-field admin-image-field"
              data-field="image"
              value="${image}"
              placeholder="https://..."
            >
          </td>
          <td>
            <div class="d-flex flex-column gap-2">
              <select class="form-select form-select-sm admin-field" data-field="descuento">
                <option value="true" ${descuento ? "selected" : ""}>Activo</option>
                <option value="false" ${!descuento ? "selected" : ""}>Inactivo</option>
              </select>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                class="form-control form-control-sm admin-field admin-discount-field"
                data-field="porcentajeDescuento"
                value="${descuento ? porcentajeDescuento : 0}"
                ${descuento ? "" : "disabled"}
              >
              <div class="small text-muted" data-field="discount-label">${discountLabel}</div>
            </div>
          </td>
          <td>
            <select class="form-select form-select-sm admin-field" data-field="visible">
              <option value="true" ${visible ? "selected" : ""}>Visible</option>
              <option value="false" ${!visible ? "selected" : ""}>Oculto</option>
            </select>
          </td>
          <td class="text-end">
            <div class="d-grid gap-2">
              <button type="button" class="btn btn-outline-danger btn-sm admin-delete-button">
                <i class="bi bi-trash"></i> Eliminar
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  body.querySelectorAll("tr[data-product-id]").forEach((row) => {
    setPricePreview(row);
    setDiscountPreview(row);
    syncProductRowDirtyState(row);
  });

  updateSaveButtonState();
}

function renderCategoryRows(categories) {
  const body = document.getElementById("admin-categories-body");
  state.originalCategories.clear();

  if (!categories.length) {
    body.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-4 text-muted">
          No hay categorías para mostrar.
        </td>
      </tr>
    `;
    updateSaveButtonState();
    return;
  }

  body.innerHTML = categories
    .map((category) => {
      const id = category.id_categoria;
      const snapshot = getCategorySnapshot(category);
      state.originalCategories.set(String(id), snapshot);
      const nombre = escapeHtml(category.nombre ?? "");
      const visible = category.visible !== false;

      return `
        <tr data-category-id="${id}" data-dirty="false">
          <td class="text-muted">${id}</td>
          <td>
            <input
              type="text"
              class="form-control form-control-sm admin-field"
              data-field="nombre"
              value="${nombre}"
            >
          </td>
          <td>
            <select class="form-select form-select-sm admin-field" data-field="visible">
              <option value="true" ${visible ? "selected" : ""}>Visible</option>
              <option value="false" ${!visible ? "selected" : ""}>Oculta</option>
            </select>
          </td>
          <td class="text-end">
            <div class="d-grid gap-2 d-sm-flex justify-content-end">
              <button type="button" class="btn btn-outline-danger btn-sm admin-delete-category-button">
                <i class="bi bi-trash"></i> Eliminar
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  updateSaveButtonState();
}

function renderPagination() {
  const pagination = document.getElementById("admin-pagination");
  if (!pagination) {
    return;
  }

  if (state.activeView !== "products" || state.productTotalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  const pageItems = [];

  const makePageItem = ({ label, page, active = false, disabled = false, icon = "" }) => `
    <li class="page-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}">
      <button
        type="button"
        class="page-link"
        data-page="${page}"
        ${disabled ? "disabled" : ""}
        ${active ? 'aria-current="page"' : ""}
      >
        ${icon ? `<i class="bi ${icon}"></i> ` : ""}
        ${label}
      </button>
    </li>
  `;

  pageItems.push(
    makePageItem({
      label: "Anterior",
      page: state.productPage - 1,
      disabled: state.productPage === 1,
      icon: "bi-chevron-left",
    }),
  );

  for (let page = 1; page <= state.productTotalPages; page += 1) {
    pageItems.push(
      makePageItem({
        label: page,
        page,
        active: page === state.productPage,
      }),
    );
  }

  pageItems.push(
    makePageItem({
      label: "Siguiente",
      page: state.productPage + 1,
      disabled: state.productPage === state.productTotalPages,
      icon: "bi-chevron-right",
    }),
  );

  pagination.innerHTML = pageItems.join("");
}

function renderUsersPagination() {
  const pagination = document.getElementById("admin-users-pagination");
  if (!pagination) {
    return;
  }

  if (state.userTotalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  const makePageItem = ({ label, page, active = false, disabled = false }) => `
    <li class="page-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}">
      <button type="button" class="page-link" data-user-page="${page}" ${disabled ? "disabled" : ""} ${active ? 'aria-current="page"' : ""}>
        ${label}
      </button>
    </li>
  `;

  const pageItems = [
    makePageItem({
      label: "Anterior",
      page: state.userPage - 1,
      disabled: state.userPage === 1,
    }),
  ];

  for (let page = 1; page <= state.userTotalPages; page += 1) {
    pageItems.push(
      makePageItem({
        label: page,
        page,
        active: page === state.userPage,
      }),
    );
  }

  pageItems.push(
    makePageItem({
      label: "Siguiente",
      page: state.userPage + 1,
      disabled: state.userPage === state.userTotalPages,
    }),
  );

  pagination.innerHTML = pageItems.join("");
}

async function loadUsers(page = state.userPage) {
  const body = document.getElementById("admin-users-body");
  body.innerHTML = `
    <tr>
      <td colspan="7" class="text-center py-4 text-muted">Cargando usuarios...</td>
    </tr>
  `;
  setMessage("Cargando usuarios...");

  try {
    const data = await fetchAdminUsers({ page, limit: ADMIN_PAGE_SIZE });
    const users = Array.isArray(data.usuarios) ? data.usuarios : [];
    const pagination = data.pagination ?? {};

    state.userPage = Number(pagination.page) || page;
    state.userTotalPages = Math.max(1, Number(pagination.totalPages) || 1);

    if (!users.length) {
      body.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-4 text-muted">No hay usuarios registrados.</td>
        </tr>
      `;
    } else {
      body.innerHTML = users
        .map((user) => {
          const userId = escapeHtml(String(user.id ?? ""));
          const nombre = escapeHtml(String(user.nombre ?? "").trim() || "-");
          const apellido = escapeHtml(String(user.apellido ?? "").trim() || "-");
          const email = escapeHtml(String(user.email ?? ""));
          const role = escapeHtml(getFriendlyRoleLabel(user) || "-");
          const isActive = user.activo !== false;
          const statusLabel = isActive ? "Activa" : "Inactiva";
          const statusClass = isActive ? "text-success" : "text-danger";
          const registrationDate = user.createdAt ? new Date(user.createdAt) : null;
          const formattedDate =
            registrationDate && Number.isFinite(registrationDate.getTime())
              ? registrationDate.toLocaleDateString("es-AR")
              : "-";

          return `
            <tr>
              <td class="text-center text-muted">${userId}</td>
              <td>${nombre}</td>
              <td>${apellido}</td>
              <td>${email}</td>
              <td class="text-center text-capitalize">${role}</td>
              <td class="text-center ${statusClass}">${statusLabel}</td>
              <td class="text-center">${escapeHtml(formattedDate)}</td>
            </tr>
          `;
        })
        .join("");
    }

    renderUsersPagination();
    setMessage(`Mostrando ${users.length} de ${Number(pagination.total) || 0} usuarios.`);
  } catch (error) {
    console.error("Error al cargar usuarios:", error);
    state.userTotalPages = 1;
    body.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-4 text-danger">No se pudieron cargar los usuarios.</td>
      </tr>
    `;
    renderUsersPagination();
    setMessage(error.message, "danger");
  }
}

function ensureDeleteModal() {
  if (!deleteModalInstance) {
    const modalElement = document.getElementById("deleteConfirmModal");
    deleteModalInstance = new bootstrap.Modal(modalElement);
  }

  return deleteModalInstance;
}

function showActiveView() {
  updateViewButtons();
  updateVisibleSections();
  updateProductFilterInputs();
  renderProductCategoryFilterOptions();
  updateSaveButtonState();
}

async function loadCategories() {
  const body = document.getElementById("admin-categories-body");
  body.innerHTML = `
    <tr>
      <td colspan="3" class="text-center py-4 text-muted">Cargando...</td>
    </tr>
  `;
  setMessage("Cargando categorías...");

  try {
    const categorias = await fetchCategorias({ includeHidden: true });
    state.categories = Array.isArray(categorias) ? categorias : [];
    renderProductCategoryFilterOptions();
    renderCategoryRows(state.categories);
    setMessage(`Mostrando ${state.categories.length} categorías.`);
    return state.categories;
  } catch (error) {
    console.error("Error al cargar las categorías:", error);
    body.innerHTML = `
      <tr>
        <td colspan="3" class="text-center py-4 text-danger">
          No se pudieron cargar las categorías.
        </td>
      </tr>
    `;
    setMessage(error.message, "danger");
    return [];
  }
}

async function loadProducts(page = 1) {
  const body = document.getElementById("admin-products-body");
  body.innerHTML = `
    <tr>
      <td colspan="9" class="text-center py-4 text-muted">Cargando...</td>
    </tr>
  `;
  setMessage(`Cargando publicaciones...`);

  try {
    try {
      const categorias = await fetchCategorias({ includeHidden: true });
      state.categories = Array.isArray(categorias) ? categorias : [];
      renderProductCategoryFilterOptions();
    } catch (error) {
      console.error("Error al cargar las categorías:", error);
      state.categories = [];
      renderProductCategoryFilterOptions();
    }

    const data = await fetchAdminProducts({ page: 1, limit: ADMIN_FETCH_LIMIT });
    const productos = data.productos ?? [];
    state.productDrafts.clear();
    state.allProducts = Array.isArray(productos) ? productos : [];
    state.productTotalItems = data.pagination?.total ?? state.allProducts.length;

    return applyProductSearch(page);
  } catch (error) {
    console.error("Error al cargar publicaciones:", error);
    body.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-danger">
          No se pudieron cargar las publicaciones.
        </td>
      </tr>
    `;
    renderProductPagination(0);
    setMessage(error.message, "danger");
    return [];
  }
}

function applyProductSearch(page = 1) {
  const filteredProducts = getFilteredProducts();
  const totalPages = filteredProducts.length > 0
    ? Math.ceil(filteredProducts.length / ADMIN_PAGE_SIZE)
    : 1;
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * ADMIN_PAGE_SIZE;
  const visibleProducts = filteredProducts.slice(start, start + ADMIN_PAGE_SIZE);

  state.productPage = currentPage;
  state.productTotalPages = totalPages;
  renderProductRows(visibleProducts);
  renderProductPagination(filteredProducts.length);

  const activeFilters = Object.entries(state.productFilters)
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .length;

  if (activeFilters > 0) {
    setMessage(
      `Mostrando ${visibleProducts.length} de ${filteredProducts.length} publicaciones con ${activeFilters} filtro${activeFilters === 1 ? "" : "s"} activo${activeFilters === 1 ? "" : "s"}.`,
    );
  } else {
    setMessage(`Mostrando ${visibleProducts.length} de ${state.productTotalItems} publicaciones.`);
  }

  return visibleProducts;
}

async function loadActiveView() {
  showActiveView();

  if (state.activeView === "products") {
    return loadProducts(state.productPage);
  }

  if (state.activeView === "categories") {
    return loadCategories();
  }

  return loadUsers(state.userPage);
}

function getChangedProductFields(row) {
  const productId = row?.dataset.productId;
  const snapshot = state.originalProducts.get(String(productId));

  if (!snapshot) {
    return null;
  }

  const current = normalizeProductRowData(row);
  const changes = {};

  if (current.nombre !== snapshot.nombre) {
    changes.nombre = current.nombre;
  }

  if (current.id_categoria !== snapshot.id_categoria) {
    changes.id_categoria = current.id_categoria;
  }

  if (current.precio !== snapshot.precio) {
    changes.precio = current.precio;
  }

  if (current.stock !== snapshot.stock) {
    changes.stock = current.stock;
  }

  if (current.image !== snapshot.image) {
    changes.image = current.image;
  }

  if (current.descuento !== snapshot.descuento) {
    changes.descuento = current.descuento;
  }

  if (current.porcentajeDescuento !== snapshot.porcentajeDescuento) {
    changes.porcentajeDescuento = current.porcentajeDescuento;
  }

  if (current.visible !== snapshot.visible) {
    changes.visible = current.visible;
  }

  return Object.keys(changes).length ? changes : null;
}

function getChangedCategoryFields(row) {
  const categoryId = row?.dataset.categoryId;
  const snapshot = state.originalCategories.get(String(categoryId));

  if (!snapshot) {
    return null;
  }

  const current = normalizeCategoryRowData(row);
  const changes = {};

  if (current.nombre !== snapshot.nombre) {
    changes.nombre = current.nombre;
  }

  if (current.visible !== snapshot.visible) {
    changes.visible = current.visible;
  }

  return Object.keys(changes).length ? changes : null;
}

function rowMatchesProductSnapshot(row, snapshot) {
  const current = normalizeProductRowData(row);
  return (
    current.nombre === snapshot.nombre &&
    current.id_categoria === snapshot.id_categoria &&
    current.precio === snapshot.precio &&
    current.stock === snapshot.stock &&
    current.image === snapshot.image &&
    current.descuento === snapshot.descuento &&
    current.porcentajeDescuento === snapshot.porcentajeDescuento &&
    current.visible === snapshot.visible
  );
}

function rowMatchesCategorySnapshot(row, snapshot) {
  const current = normalizeCategoryRowData(row);
  return current.nombre === snapshot.nombre && current.visible === snapshot.visible;
}

function syncProductRowDirtyState(row) {
  const productId = row?.dataset.productId;
  if (!productId) {
    return;
  }

  const snapshot = state.originalProducts.get(String(productId));
  if (!snapshot) {
    row.dataset.dirty = "false";
    updateSaveButtonState();
    return;
  }

  const current = normalizeProductRowData(row);
  state.productDrafts.set(String(productId), current);

  const dirty = !rowMatchesProductSnapshot(row, snapshot);
  row.dataset.dirty = dirty ? "true" : "false";

  if (!dirty) {
    state.productDrafts.delete(String(productId));
  }

  updateSaveButtonState();
}

function syncCategoryRowDirtyState(row) {
  const categoryId = row?.dataset.categoryId;
  if (!categoryId) {
    return;
  }

  const snapshot = state.originalCategories.get(String(categoryId));
  if (!snapshot) {
    row.dataset.dirty = "false";
    updateSaveButtonState();
    return;
  }

  row.dataset.dirty = rowMatchesCategorySnapshot(row, snapshot) ? "false" : "true";
  updateSaveButtonState();
}

function validateProductRowData(row) {
  const data = normalizeProductRowData(row);

  if (!data.nombre) {
    throw new Error("El título no puede estar vacío.");
  }

  if (!Number.isInteger(data.id_categoria) || data.id_categoria <= 0) {
    throw new Error("Seleccioná una categoría válida.");
  }

  const categoryExists = state.categories.some(
    (category) => String(category.id_categoria) === String(data.id_categoria),
  );

  if (!categoryExists) {
    throw new Error("La categoría seleccionada no existe.");
  }

  if (!Number.isFinite(data.precio) || data.precio < 0) {
    throw new Error("El precio debe ser un número válido.");
  }

  if (!Number.isInteger(data.stock) || data.stock < 0) {
    throw new Error("El stock debe ser un número entero válido.");
  }

  if (!data.image) {
    throw new Error("El link de la imagen no puede estar vacío.");
  }

  if (data.descuento) {
    if (!Number.isFinite(data.porcentajeDescuento) || data.porcentajeDescuento < 1) {
      throw new Error("Si el descuento está activo, el porcentaje debe ser como mínimo 1%.");
    }

    if (data.porcentajeDescuento > 100) {
      throw new Error("El descuento no puede ser mayor a 100%.");
    }
  }

  return data;
}

function validateCategoryRowData(row) {
  const data = normalizeCategoryRowData(row);

  if (!data.nombre) {
    throw new Error("El nombre de la categoría no puede estar vacío.");
  }

  return data;
}

async function saveProductRow(row) {
  const productId = row?.dataset.productId;
  if (!productId) {
    return { saved: false, skipped: true };
  }

  const changes = getChangedProductFields(row);
  if (!changes) {
    row.dataset.dirty = "false";
    return { saved: false, skipped: true };
  }

  const current = validateProductRowData(row);
  await updateProduct(productId, changes);
  state.originalProducts.set(String(productId), current);
  state.productDrafts.delete(String(productId));

  const existingProduct = state.allProducts.find((item) => String(getProductoId(item)) === String(productId));
  if (existingProduct) {
    Object.assign(existingProduct, current);
  }

  row.dataset.dirty = "false";
  return { saved: true, skipped: false };
}

async function saveCategoryRow(row) {
  const categoryId = row?.dataset.categoryId;
  if (!categoryId) {
    return { saved: false, skipped: true };
  }

  const changes = getChangedCategoryFields(row);
  if (!changes) {
    row.dataset.dirty = "false";
    return { saved: false, skipped: true };
  }

  const current = validateCategoryRowData(row);
  await updateCategoria(categoryId, changes);
  state.originalCategories.set(String(categoryId), current);
  const category = state.categories.find((item) => String(item.id_categoria) === String(categoryId));
  if (category) {
    category.nombre = current.nombre;
    category.visible = current.visible;
  }
  row.dataset.dirty = "false";
  return { saved: true, skipped: false };
}

async function saveAllChanges() {
  if (state.activeView === "users") {
    return;
  }

  const rows = Array.from(document.querySelectorAll(getDirtyRowsSelector()));

  if (!rows.length) {
    setMessage("No hay cambios para guardar.");
    updateSaveButtonState();
    return;
  }

  state.saving = true;
  updateSaveButtonState();
  setMessage("Guardando cambios...");

  let savedCount = 0;
  let failedCount = 0;
  let firstError = "";

  try {
    for (const row of rows) {
      try {
        const result =
          state.activeView === "products"
            ? await saveProductRow(row)
            : await saveCategoryRow(row);
        if (result.saved) {
          savedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        if (!firstError) {
          firstError = error.message;
        }
      }
    }

    if (savedCount > 0) {
      broadcastProductChange({
        page: state.productPage,
        action: state.activeView === "products" ? "bulk-update-products" : "bulk-update-categories",
      });
    }

    if (failedCount === 0 && savedCount > 0) {
      setMessage("Cambios guardados correctamente.", "success");
    } else if (savedCount > 0) {
      setMessage(
        `Se guardaron ${savedCount} cambios y quedaron ${failedCount} pendientes.${firstError ? ` ${firstError}` : ""}`,
        "warning",
      );
    } else if (failedCount > 0) {
      setMessage(firstError || "No se pudieron guardar los cambios.", "danger");
    }
  } finally {
    state.saving = false;
    updateSaveButtonState();
  }
}

function openDeleteConfirmation({ type, id, name }) {
  const modal = ensureDeleteModal();
  const confirmButton = document.getElementById("confirm-delete-button");
  const message = document.getElementById("delete-confirmation-text");

  state.pendingDelete = { type, id, name };

  if (type === "product") {
    message.textContent = `¿De verdad querés eliminar permanentemente "${name}"? Esta acción no se puede deshacer.`;
    document.getElementById("deleteConfirmModalLabel").textContent = "Eliminar publicación";
  } else {
    message.textContent = `¿De verdad querés eliminar permanentemente la categoría "${name}"? Esta acción no se puede deshacer.`;
    document.getElementById("deleteConfirmModalLabel").textContent = "Eliminar categoría";
  }

  modal.show();
  confirmButton.focus();
}

async function confirmDelete() {
  if (!state.pendingDelete?.id) {
    return;
  }

  const { id, type } = state.pendingDelete;
  const confirmButton = document.getElementById("confirm-delete-button");
  const previousLabel = confirmButton.innerHTML;
  confirmButton.disabled = true;
  confirmButton.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Eliminando';

  try {
    if (type === "product") {
      const response = await fetch(`/api/productos/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo eliminar el producto");
      }

      ensureDeleteModal().hide();
      broadcastProductChange({
        productId: id,
        page: state.productPage,
        action: "delete-product",
      });

      state.allProducts = state.allProducts.filter((item) => String(getProductoId(item)) !== String(id));
      state.productTotalItems = state.allProducts.length;
      if (state.activeView === "products") {
        applyProductSearch(state.productPage);
      }

      setMessage("Publicación eliminada permanentemente.", "success");
    } else {
      await deleteCategoria(id);
      ensureDeleteModal().hide();
      broadcastProductChange({
        categoryId: id,
        page: state.productPage,
        action: "delete-category",
      });

      state.categories = state.categories.filter((category) => String(category.id_categoria) !== String(id));
      renderCategoryRows(state.categories);
      setMessage("Categoría eliminada permanentemente.", "success");
    }
  } catch (error) {
    console.error("Error al eliminar elemento:", error);
    setMessage(error.message, "danger");
  } finally {
    confirmButton.disabled = false;
    confirmButton.innerHTML = previousLabel;
    state.pendingDelete = null;
  }
}

async function handleCreateCategory() {
  const input = document.getElementById("new-category-name");
  const button = document.getElementById("create-category-button");
  const nombre = String(input.value ?? "").trim();

  if (!nombre) {
    setMessage("Escribí un nombre para la nueva categoría.", "warning");
    input.focus();
    return;
  }

  state.creatingCategory = true;
  button.disabled = true;
  const previousLabel = button.innerHTML;
  button.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Creando';

  try {
    await createCategoria({ nombre });
    input.value = "";
    broadcastProductChange({
      page: state.productPage,
      action: "create-category",
    });
    await loadCategories();
    setMessage("Categoría creada correctamente.", "success");
  } catch (error) {
    setMessage(error.message, "danger");
  } finally {
    state.creatingCategory = false;
    button.disabled = false;
    button.innerHTML = previousLabel;
  }
}

function handleLogout() {
  logoutSession();
  renderShell();
}

async function switchView(view) {
  if (state.activeView === view) {
    await loadActiveView();
    return;
  }

  state.activeView = view;
  showActiveView();
  await loadActiveView();
}

function renderShell() {
  const user = getStoredUser();
  const status = document.getElementById("session-status");
  const logoutButton = document.getElementById("logout-button");
  const guardSection = document.getElementById("admin-guard");
  const appSection = document.getElementById("admin-app");

  if (!user) {
    status.textContent = "Modo invitado";
    logoutButton.classList.add("d-none");
    guardSection.classList.remove("d-none");
    appSection.classList.add("d-none");
    setGuardMessage("Iniciá sesión como administrador desde la página principal.");
    return;
  }

  const roleLabel = getFriendlyRoleLabel(user);
  status.textContent = roleLabel ? `Conectado como ${roleLabel}` : "Modo invitado";
  logoutButton.classList.remove("d-none");

  if (!isAdminUser(user)) {
    guardSection.classList.remove("d-none");
    appSection.classList.add("d-none");
    setGuardMessage("Tu cuenta no tiene permisos para acceder a esta sección.");
    return;
  }

  guardSection.classList.add("d-none");
  appSection.classList.remove("d-none");
  showActiveView();
  loadActiveView();
}

document.getElementById("logout-button").addEventListener("click", handleLogout);

document.getElementById("refresh-button").addEventListener("click", async () => {
  await loadActiveView();
});

document.getElementById("save-changes-button").addEventListener("click", saveAllChanges);

document.getElementById("products-view-button").addEventListener("click", async () => {
  await switchView("products");
});

document.getElementById("categories-view-button").addEventListener("click", async () => {
  await switchView("categories");
});

document.getElementById("users-view-button").addEventListener("click", async () => {
  await switchView("users");
});

document.getElementById("create-category-button").addEventListener("click", handleCreateCategory);

document.getElementById("export-products-button").addEventListener("click", exportProductsToXlsx);

[
  "filter-product-id",
  "filter-product-title",
  "filter-product-price-min",
  "filter-product-price-max",
  "filter-product-stock-min",
  "filter-product-stock-max",
  "filter-product-image",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    if (state.activeView === "products") {
      applyProductFilterState(1);
    }
  });
});

[
  "filter-product-category",
  "filter-product-discount",
  "filter-product-visible",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => {
    if (state.activeView === "products") {
      applyProductFilterState(1);
    }
  });
});

document.getElementById("clear-product-filters-button").addEventListener("click", () => {
  clearProductFilters();
});

document.getElementById("new-category-name").addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await handleCreateCategory();
  }
});

document.getElementById("admin-pagination").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled || state.activeView !== "products") {
    return;
  }

  const page = Number(button.dataset.page);
  if (!Number.isInteger(page) || page < 1 || page === state.productPage) {
    return;
  }

  await loadProducts(page);
});

document.getElementById("admin-users-pagination").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-page]");
  if (!button || button.disabled || state.activeView !== "users") {
    return;
  }

  const page = Number(button.dataset.userPage);
  if (!Number.isInteger(page) || page < 1 || page === state.userPage) {
    return;
  }

  await loadUsers(page);
});

document.getElementById("admin-products-body").addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".admin-delete-button");
  if (deleteButton) {
    const row = deleteButton.closest("tr");
    openDeleteConfirmation({
      type: "product",
      id: row?.dataset.productId,
      name: row?.querySelector('[data-field="nombre"]')?.value?.trim() || "esta publicación",
    });
  }
});

document.getElementById("admin-products-body").addEventListener("change", (event) => {
  const row = event.target.closest("tr[data-product-id]");
  if (!row || state.activeView !== "products") {
    return;
  }

  if (event.target.closest('[data-field="descuento"]')) {
    setDiscountPreview(row);
  }

  syncProductRowDirtyState(row);
});

document.getElementById("admin-products-body").addEventListener("input", (event) => {
  const row = event.target.closest("tr[data-product-id]");
  if (!row || state.activeView !== "products") {
    return;
  }

  if (event.target.closest('[data-field="precio"]')) {
    setPricePreview(row);
  }

  if (event.target.closest('[data-field="porcentajeDescuento"]')) {
    setDiscountPreview(row);
  }

  syncProductRowDirtyState(row);
});

document.getElementById("admin-categories-body").addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".admin-delete-category-button");
  if (!deleteButton || state.activeView !== "categories") {
    return;
  }

  const row = deleteButton.closest("tr");
  openDeleteConfirmation({
    type: "category",
    id: row?.dataset.categoryId,
    name: row?.querySelector('[data-field="nombre"]')?.value?.trim() || "esta categoría",
  });
});

document.getElementById("admin-categories-body").addEventListener("change", (event) => {
  const row = event.target.closest("tr[data-category-id]");
  if (!row || state.activeView !== "categories") {
    return;
  }

  syncCategoryRowDirtyState(row);
});

document.getElementById("admin-categories-body").addEventListener("input", (event) => {
  const row = event.target.closest("tr[data-category-id]");
  if (!row || state.activeView !== "categories") {
    return;
  }

  syncCategoryRowDirtyState(row);
});

document.getElementById("confirm-delete-button").addEventListener("click", confirmDelete);

subscribeToProductChanges(async () => {
  if (isAdminUser()) {
    await loadActiveView();
  }
});

window.addEventListener("storage", () => {
  renderShell();
});

renderShell();
