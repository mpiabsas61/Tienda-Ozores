import sequelize from '../config/database.js';
import { DataTypes } from 'sequelize';

import Usuario from './Usuario.js';
import OrdenCompra from './OrdenCompra.js';
import DetalleOrden from './DetalleOrden.js';
import Producto from './Producto.js';
import Categoria from './Categoria.js';
import { Cupon } from './Cupon.js';

import seedDatabase from './seed.js';

Usuario.hasMany(OrdenCompra, { foreignKey: 'usuario_id', as: 'ordenes' });
OrdenCompra.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });

Cupon.hasMany(OrdenCompra, { foreignKey: 'cupon_id', as: 'ordenes' });
OrdenCompra.belongsTo(Cupon, { foreignKey: 'cupon_id', as: 'cupon' });

OrdenCompra.hasMany(DetalleOrden, { foreignKey: 'id_orden', as: 'detalles' });
DetalleOrden.belongsTo(OrdenCompra, { foreignKey: 'id_orden', as: 'orden' });

Producto.hasMany(DetalleOrden, { foreignKey: 'producto_id', as: 'detalles' });
DetalleOrden.belongsTo(Producto, { foreignKey: 'producto_id', as: 'producto' });

Categoria.hasMany(Producto, { foreignKey: 'id_categoria', as: 'productos' });
Producto.belongsTo(Categoria, { foreignKey: 'id_categoria', as: 'categoria' });

async function ensureProductValidityColumns() {
    const queryInterface = sequelize.getQueryInterface();
    const table = await queryInterface.describeTable('Producto');

    if (!table.validoDesde) {
        await queryInterface.addColumn('Producto', 'validoDesde', {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: '2000-01-01'
        });
    }

    if (!table.validoHasta) {
        await queryInterface.addColumn('Producto', 'validoHasta', {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: '2099-12-31'
        });
    }

    if (!table.visible) {
        await queryInterface.addColumn('Producto', 'visible', {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        });
    }

    if (!table.descuento) {
        await queryInterface.addColumn('Producto', 'descuento', {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
    }

    if (!table.porcentajeDescuento) {
        await queryInterface.addColumn('Producto', 'porcentajeDescuento', {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0
        });
    }
}

async function ensureUsuarioColumns() {
    const queryInterface = sequelize.getQueryInterface();
    const table = await queryInterface.describeTable('Usuario');

    if (!table.apellido) {
        await queryInterface.addColumn('Usuario', 'apellido', {
            type: DataTypes.STRING,
            allowNull: true
        });
    }

    if (!table.role) {
        await queryInterface.addColumn('Usuario', 'role', {
            type: DataTypes.STRING,
            defaultValue: 'client'
        });
    }

    if (!table.activo) {
        await queryInterface.addColumn('Usuario', 'activo', {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        });
    }

    if (!table.passwordResetTokenHash) {
        await queryInterface.addColumn('Usuario', 'passwordResetTokenHash', {
            type: DataTypes.STRING,
            allowNull: true
        });
    }

    if (!table.passwordResetExpiresAt) {
        await queryInterface.addColumn('Usuario', 'passwordResetExpiresAt', {
            type: DataTypes.DATE,
            allowNull: true
        });
    }

    if (!table.passwordResetAttempts) {
        await queryInterface.addColumn('Usuario', 'passwordResetAttempts', {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        });
    }
}

async function ensureCategoryColumns() {
    const queryInterface = sequelize.getQueryInterface();
    const table = await queryInterface.describeTable('Categoria');

    if (!table.visible) {
        await queryInterface.addColumn('Categoria', 'visible', {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        });
    }
}

async function ensureCouponColumns() {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = Cupon.getTableName();
    const table = await queryInterface.describeTable(tableName);

    if (!table.validoDesde) {
        await queryInterface.addColumn(tableName, 'validoDesde', {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: '2000-01-01'
        });
    }

    if (!table.validoHasta) {
        await queryInterface.addColumn(tableName, 'validoHasta', {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: '2099-12-31'
        });
    }
}

export async function initializeDatabase() {
    await sequelize.sync();

    await ensureProductValidityColumns();
    await ensureUsuarioColumns();
    await ensureCategoryColumns();
    await ensureCouponColumns();

    await seedDatabase({ Categoria, Producto, Usuario, Cupon });
}

export {
    sequelize,
    Categoria,
    Producto,
    Usuario,
    Cupon,
    OrdenCompra,
    DetalleOrden
};
