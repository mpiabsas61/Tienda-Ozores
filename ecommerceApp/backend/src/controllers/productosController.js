import Producto from "../models/Producto.js";
import Categoria from "../models/Categoria.js";
import { verifyToken } from "../utils/jwt.js";

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildPagination(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

const PRODUCT_SORT_ORDERS = {
  price_desc: [["precio", "DESC"], ["id", "ASC"]],
  price_asc: [["precio", "ASC"], ["id", "ASC"]],
  stock_asc: [["stock", "ASC"], ["id", "ASC"]],
};

function isAdminRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  try {
    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);
    return payload?.role === "admin";
  } catch (error) {
    return false;
  }
}

function normalizeDiscountFields(body = {}, existing = null) {
  const hasDescuentoField = Object.prototype.hasOwnProperty.call(body, "descuento");
  const hasPercentageField = Object.prototype.hasOwnProperty.call(
    body,
    "porcentajeDescuento",
  );

  const descuentoSource = hasDescuentoField
    ? body.descuento
    : existing?.descuento ?? false;

  const descuento =
    descuentoSource === true ||
    descuentoSource === "true" ||
    descuentoSource === 1 ||
    descuentoSource === "1";

  const parsedPercentage = hasPercentageField
    ? Number(body.porcentajeDescuento)
    : Number(existing?.porcentajeDescuento ?? 0);
  const porcentajeDescuento = descuento ? parsedPercentage : 0;

  if (descuento) {
    if (!Number.isFinite(parsedPercentage) || parsedPercentage < 1) {
      throw new Error(
        "Si el descuento está activo, el porcentaje debe ser como mínimo 1%.",
      );
    }

    if (parsedPercentage > 100) {
      throw new Error("El descuento no puede ser mayor a 100%.");
    }
  }

  return {
    descuento,
    porcentajeDescuento,
  };
}

async function resolveCategoryId(body = {}, existing = null) {
  const hasCategoryField = Object.prototype.hasOwnProperty.call(body, "id_categoria");
  const categorySource = hasCategoryField ? body.id_categoria : existing?.id_categoria;
  const categoriaId = Number(categorySource);

  if (!Number.isInteger(categoriaId) || categoriaId <= 0) {
    throw new Error("Debes seleccionar una categoría válida.");
  }

  const categoria = await Categoria.findByPk(categoriaId);
  if (!categoria) {
    throw new Error("La categoría seleccionada no existe.");
  }

  return categoriaId;
}

async function findProducts({ where, page, limit, publicOnly = false, sortBy = "" }) {
  const categoryInclude = {
    model: Categoria,
    as: "categoria",
  };

  if (publicOnly) {
    categoryInclude.required = true;
    categoryInclude.where = { visible: true };
  }

  const queryOptions = {
    where,
    include: [categoryInclude],
    order: PRODUCT_SORT_ORDERS[sortBy] ?? [["id", "ASC"]],
  };

  if (page && limit) {
    queryOptions.limit = limit;
    queryOptions.offset = (page - 1) * limit;

    const { count, rows } = await Producto.findAndCountAll(queryOptions);

    return {
      productos: rows,
      pagination: buildPagination(page, limit, count),
    };
  }

  return Producto.findAll(queryOptions);
}

const productsController = {
  getAll: async (req, res) => {
    try {
      const where = {};
      const categoriaId = Number(req.query.id_categoria);
      const page = parsePositiveInteger(req.query.page);
      const limit = parsePositiveInteger(req.query.limit);
      const sortBy = String(req.query.sort ?? "");

      if (sortBy && !Object.hasOwn(PRODUCT_SORT_ORDERS, sortBy)) {
        return res.status(400).json({ error: "El criterio de ordenamiento no es válido." });
      }

      if (Number.isInteger(categoriaId) && categoriaId > 0) {
        where.id_categoria = categoriaId;
      }

      where.visible = true;

      const resultado = await findProducts({ where, page, limit, publicOnly: true, sortBy });
      res.json(resultado);
    } catch (error) {
      res.status(500).json({ error: "Error al obtener los productos" });
    }
  },

  getAdminAll: async (req, res) => {
    try {
      const where = {};
      const categoriaId = Number(req.query.id_categoria);
      const page = parsePositiveInteger(req.query.page) ?? 1;
      const limit = parsePositiveInteger(req.query.limit) ?? 10;

      if (Number.isInteger(categoriaId) && categoriaId > 0) {
        where.id_categoria = categoriaId;
      }

      const resultado = await findProducts({ where, page, limit });
      res.json(resultado);
    } catch (error) {
      res.status(500).json({ error: "Error al obtener los productos" });
    }
  },

  getById: async (req, res) => {
    try {
      const producto = await Producto.findByPk(req.params.id, {
        include: [{ model: Categoria, as: "categoria" }],
      });

      if (!producto) {
        res.status(404).json({ error: "Producto no encontrado" });
        return;
      }

      if (!isAdminRequest(req)) {
        const categoriaVisible = producto.categoria?.visible !== false;
        if (!producto.visible || !categoriaVisible) {
          res.status(404).json({ error: "Producto no encontrado" });
          return;
        }
      }

      if (producto) {
        res.json(producto);
      }
    } catch (error) {
      res.status(500).json({ error: "Error en el servidor" });
    }
  },

  create: async (req, res) => {
    try {
      const id_categoria = await resolveCategoryId(req.body);
      const nuevoProducto = await Producto.create({
        ...req.body,
        id_categoria,
        ...normalizeDiscountFields(req.body),
      });

      res
        .status(201)
        .json({ mensaje: "Creado con éxito", producto: nuevoProducto });
    } catch (error) {
      res.status(400).json({ error: error.message || "Datos inválidos o incompletos" });
    }
  },

  update: async (req, res) => {
    try {
      const existente = await Producto.findByPk(req.params.id);
      if (!existente) {
        res.status(404).json({ error: "No se encontró el producto a actualizar" });
        return;
      }

      const id_categoria = await resolveCategoryId(req.body, existente);
      const [actualizado] = await Producto.update(
        {
          ...req.body,
          id_categoria,
          ...normalizeDiscountFields(req.body, existente),
        },
        {
          where: { id: req.params.id },
        },
      );

      if (actualizado) {
        res.json({ mensaje: "Producto actualizado correctamente" });
      } else {
        res.status(404).json({ error: "No se encontró el producto a actualizar" });
      }
    } catch (error) {
      res.status(400).json({ error: error.message || "Error al actualizar" });
    }
  },

  delete: async (req, res) => {
    try {
      const borrados = await Producto.destroy({ where: { id: req.params.id } });
      if (borrados > 0) {
        res.json({ mensaje: "Producto eliminado correctamente" });
      } else {
        res.status(404).json({ error: "El producto no existe" });
      }
    } catch (error) {
      res.status(500).json({ error: "Error al intentar eliminar" });
    }
  },
};

export default productsController;
