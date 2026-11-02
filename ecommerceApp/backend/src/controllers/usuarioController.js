import usersDb from "../../database/users_db.js";
import Usuario from "../models/Usuario.js";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Op } from "sequelize";

const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_RESPONSE = {
  mensaje: "Si existe una cuenta con ese email, se generó un código de recuperación.",
};
const PROFILE_ATTRIBUTES = ["id", "nombre", "apellido", "email", "role", "telefono", "fecha_nacimiento"];
const PROFILE_FIELDS = ["nombre", "apellido", "telefono", "fecha_nacimiento"];

function hashResetCode(code) {
  return createHash("sha256").update(code).digest("hex");
}

function validateProfileUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Ingresá datos válidos para actualizar el perfil." };
  }

  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !PROFILE_FIELDS.includes(field))) {
    return { error: "Solo se pueden modificar nombre, apellido, teléfono y fecha de nacimiento." };
  }

  const updates = {};
  for (const field of fields) {
    if (typeof body[field] !== "string") {
      return { error: `El campo ${field} no es válido.` };
    }
    updates[field] = body[field].trim();
  }

  if ("nombre" in updates && (!updates.nombre || updates.nombre.length > 100)) {
    return { error: "El nombre es obligatorio y no puede superar los 100 caracteres." };
  }

  if ("apellido" in updates) {
    if (updates.apellido.length > 100) {
      return { error: "El apellido no puede superar los 100 caracteres." };
    }
    updates.apellido = updates.apellido || null;
  }

  if ("telefono" in updates) {
    if (updates.telefono.length > 30) {
      return { error: "El teléfono no puede superar los 30 caracteres." };
    }
    updates.telefono = updates.telefono || null;
  }

  if ("fecha_nacimiento" in updates) {
    const birthDate = updates.fecha_nacimiento;
    if (birthDate) {
      const parsedDate = new Date(`${birthDate}T00:00:00.000Z`);
      const isValidDate =
        /^\d{4}-\d{2}-\d{2}$/.test(birthDate) &&
        !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().slice(0, 10) === birthDate;
      if (!isValidDate || birthDate > new Date().toISOString().slice(0, 10)) {
        return { error: "Ingresá una fecha de nacimiento válida y no futura." };
      }
    } else {
      updates.fecha_nacimiento = null;
    }
  }

  return { updates };
}

function resetCodeMatches(code, expectedHash) {
  if (!expectedHash) {
    return false;
  }

  const actual = Buffer.from(hashResetCode(code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const userController = {
  register: async (req, res) => {
    try {
      const { nombre, apellido, email, password, role = "client" } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email y password son obligatorios" });
      }

      const nuevoUsuario = await Usuario.create({
        nombre: nombre || String(email).split("@")[0] || "Usuario",
        apellido: apellido || null,
        email,
        password,
        role,
        es_corporativo: false,
      });
      const usuario = nuevoUsuario.toJSON();
      delete usuario.password;
      res
        .status(201)
        .json({ mensaje: "Creado con éxito", usuario });
    } catch (error) {
      res.status(400).json({ error: "Datos inválidos o incompletos" });
    }
  },

  getAdminAll: async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);

    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "La página o el límite no son válidos" });
    }

    try {
      const count = await Usuario.count();
      const totalPages = Math.max(1, Math.ceil(count / limit));
      const currentPage = Math.min(page, totalPages);
      const usuarios = await Usuario.findAll({
        attributes: ["id", "nombre", "apellido", "email", "role", "activo", "createdAt"],
        limit,
        offset: (currentPage - 1) * limit,
        order: [["createdAt", "DESC"], ["id", "DESC"]],
      });

      res.json({
        usuarios,
        pagination: {
          page: currentPage,
          limit,
          total: count,
          totalPages,
        },
      });
    } catch (error) {
      console.error("Error al listar usuarios:", error);
      res.status(500).json({ error: "No se pudieron cargar los usuarios" });
    }
  },

  getMyProfile: async (req, res) => {
    try {
      const usuario = await Usuario.findByPk(req.user.id, {
        attributes: PROFILE_ATTRIBUTES,
      });
      if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      return res.json(usuario);
    } catch (error) {
      console.error("Error al cargar el perfil del usuario:", error);
      return res.status(500).json({ error: "No se pudo cargar el perfil." });
    }
  },

  updateMyProfile: async (req, res) => {
    const validation = validateProfileUpdate(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const usuario = await Usuario.findByPk(req.user.id);
      if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      await usuario.update(validation.updates);
      const profile = await Usuario.findByPk(usuario.id, {
        attributes: PROFILE_ATTRIBUTES,
      });

      return res.json({
        mensaje: "Los datos se actualizaron correctamente.",
        usuario: profile,
      });
    } catch (error) {
      console.error("Error al actualizar el perfil del usuario:", error);
      return res.status(500).json({ error: "No se pudieron actualizar los datos." });
    }
  },

  requestPasswordReset: async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ingresá un email válido." });
    }

    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({
        error: "La recuperación de contraseña no está configurada para enviar códigos.",
      });
    }

    try {
      const usuario = await Usuario.findOne({ where: { email } });
      if (usuario) {
        const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
        usuario.passwordResetTokenHash = hashResetCode(code);
        usuario.passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
        usuario.passwordResetAttempts = 0;
        await usuario.save();

        console.info(`[recuperacion-clave] Código de un solo uso para ${email}: ${code}`);
        console.log(`[recuperacion-clave] Código de un solo uso para ${email}: ${code}`);
      }

      return res.status(202).json(PASSWORD_RESET_RESPONSE);
    } catch (error) {
      console.error("Error al solicitar recuperación de contraseña:", error);
      return res.status(500).json({ error: "No se pudo iniciar la recuperación de contraseña." });
    }
  },

  resetPassword: async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    const code = String(req.body?.code ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!email || !code || password.length < 8) {
      return res.status(400).json({
        error: "Ingresá el email, el código y una contraseña de al menos 8 caracteres.",
      });
    }

    try {
      const usuario = await Usuario.findOne({ where: { email } });
      const now = new Date();
      const codeMatches =
        usuario?.passwordResetTokenHash &&
        usuario.passwordResetExpiresAt &&
        usuario.passwordResetExpiresAt > now &&
        usuario.passwordResetAttempts < PASSWORD_RESET_MAX_ATTEMPTS &&
        resetCodeMatches(code, usuario.passwordResetTokenHash);

      if (!usuario || !codeMatches) {
        if (
          usuario?.passwordResetTokenHash &&
          usuario.passwordResetExpiresAt &&
          usuario.passwordResetExpiresAt > now &&
          usuario.passwordResetAttempts < PASSWORD_RESET_MAX_ATTEMPTS
        ) {
          usuario.passwordResetAttempts += 1;
          if (usuario.passwordResetAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
            usuario.passwordResetTokenHash = null;
            usuario.passwordResetExpiresAt = null;
          }
          await usuario.save();
        }

        return res.status(400).json({ error: "El código no es válido o venció. Solicitá uno nuevo." });
      }

      const [updatedCount] = await Usuario.update(
        {
          password,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          passwordResetAttempts: 0,
        },
        {
          where: {
            id: usuario.id,
            passwordResetTokenHash: usuario.passwordResetTokenHash,
            passwordResetExpiresAt: { [Op.gt]: now },
            passwordResetAttempts: { [Op.lt]: PASSWORD_RESET_MAX_ATTEMPTS },
          },
          individualHooks: true,
        },
      );

      if (!updatedCount) {
        return res.status(400).json({ error: "El código no es válido o venció. Solicitá uno nuevo." });
      }

      return res.json({ mensaje: "La contraseña se actualizó correctamente." });
    } catch (error) {
      console.error("Error al restablecer contraseña:", error);
      return res.status(500).json({ error: "No se pudo actualizar la contraseña." });
    }
  },

  update: async (req, res) => {
    try {
      // Buscamos y actualizamos en base al ID que viene en la URL (req.params.id)
      const [actualizado] = await Usuario.update(req.body, {
        where: { id: parseInt(req.params.id) },
        individualHooks: true,
      });
      if (actualizado) {
        res.json({ mensaje: "Usuario actualizado correctamente" });
      } else {
        res
          .status(404)
          .json({ error: "No se encontró el usuario a actualizar" });
      }
    } catch (error) {
      res.status(500).json({ error: "Error al actualizar" });
    }
  },

  getById: async (req, res) => {
    try {
      const usuario = await Usuario.findByPk(req.params.id); // Buscar por Primary Key (ID)
      if (usuario) {
        const usuarioJson = usuario.toJSON();
        delete usuarioJson.password;
        res.json(usuarioJson);
      } else {
        res.status(404).json({ error: "Usuario no encontrado" });
      }
    } catch (error) {
      res.status(500).json({ error: "Error en el servidor" });
    }
  },

  delete: async (req, res) => {
    try {
      const borrados = await Usuario.destroy({ where: { id: req.params.id } });
      if (borrados > 0) {
        res.json({ mensaje: "Usuario eliminado correctamente" });
      } else {
        res.status(404).json({ error: "El usuario no existe" });
      }
    } catch (error) {
      res.status(500).json({ error: "Error al intentar eliminar" });
    }
  },
};

export default userController;

// function es_corporativoUsuario(usuario_id) {
//   return lista_usuarios[usuario_id]?.es_corporativo || false;
// }

// function loguearUsuario(email, password) {
//   for (let id in lista_usuarios) {
//     const u = lista_usuarios[id];
//     if (u.email === email && u.password === password) {
//       sesion.usuario_id = u.id_usuario;
//       console.log(`✔️  El usuario se logueó correctamente`);
//       return true;
//     }
//   }
//   console.log(`❌ Error al loguearse`);
//   return false;
// }

// function cerrarSesion() {
//   sesion.usuario_id = null;
// }

// function estaLogueado() {
//   return sesion.usuario_id !== null;
// }

// function verificarSesion() {
//   if (!estaLogueado()) {
//     console.log(`❌ El usuario no está logueado. Redirigiendo al login...`);
//     return false;
//   }
//   console.log(`✔️  Usuario logueado: ID ${sesion.usuario_id}`);
//   return true;
// }
