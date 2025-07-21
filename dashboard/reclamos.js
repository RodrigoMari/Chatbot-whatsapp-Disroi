const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  const estado = req.query.estado;
  const area = req.query.area;

  //filtros
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
  
  const now = new Date();

  const reclamosSerializados = reclamos.map(r => {
    let truncatedText = r.observacion.slice(0, 30);
    if (r.observacion.length > 30) truncatedText += "...";

    const reclamoFecha = new Date(r.fecha_tiempo);
    const diffHoras = Math.floor((now - reclamoFecha) / (1000 * 60 * 60));

    let filaClase = '';
    if (diffHoras > 72 && r.estado !== 'COMPLETADO') filaClase = 'bg-dark-red text-white';
    else if (diffHoras > 48 && r.estado !== 'COMPLETADO') filaClase = 'bg-red';
    else if (diffHoras > 24 && r.estado !== 'COMPLETADO') filaClase = 'bg-yellow';

    return {
      ...r,
      id: r.id.toString(),
      cliente: typeof r.cliente === 'bigint' ? r.cliente.toString() : r.cliente,
      cod_factura: typeof r.cod_factura === 'bigint' ? r.cod_factura.toString() : r.cod_factura,
      observacion: truncatedText,
      observacion_completa: r.observacion,
      filaClase
    };
  });

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