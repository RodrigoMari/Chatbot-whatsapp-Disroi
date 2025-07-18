const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  const estado = req.query.estado;
  const area = req.query.area;

  const filtro = {};

  if (estado) {
    filtro.estado = estado;
  }

  if (area) {
    filtro.area = area;
  }

  const reclamos = await prisma.reclamo.findMany({
    orderBy: { id: 'desc' },
    where: filtro,
    include: { maestro_21: true },
  });
  
  const reclamosSerializados = reclamos.map(r => ({
    ...r,
    id: r.id.toString(),
    cliente: typeof r.cliente === 'bigint' ? r.cliente.toString() : r.cliente,
    cod_factura: typeof r.cod_factura === 'bigint' ? r.cod_factura.toString() : r.cod_factura,
  }));

   res.render('reclamos', {
    reclamos: reclamosSerializados,
    estadoSeleccionado: estado,
    areaSeleccionada: area
  });
});

router.post('/resolver/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.reclamo.update({
    where: { id },
    data: { estado: 'COMPLETADO' }, // ✅
  });
  res.redirect('/reclamos');
});

router.post('/en_proceso/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.reclamo.update({
    where: { id },
    data: { estado: 'EN_PROCESO' }, // 🔄
  });
  res.redirect('/reclamos');
});

router.post('/pendiente/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.reclamo.update({
    where: { id },
    data: { estado: 'PENDIENTE' }, // ⏳
  });
  res.redirect('/reclamos');
});

module.exports = router;