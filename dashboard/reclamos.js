const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function serializeBigInt(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

router.get('/', async (req, res) => {
  const estado = req.query.estado;
  const area = req.query.area;

  //filtros
  const filtro = {};

  if (estado) {
    filtro.estado = estado;
  }

  if (area) {
    filtro.reclamo_area = {
      some: {
        area: area
      }
    };
  }

  const reclamos = await prisma.reclamo.findMany({
    orderBy: { id: 'desc' },
    where: filtro,
    include: { 
      maestro_21: true,
      reclamo_area: true
     },
  });
  
  const now = new Date();

  const reclamosSerializados = reclamos.map(r => {
    let truncatedText = r.observacion.slice(0, 30);
    if (r.observacion.length > 30) truncatedText += "...";

    const reclamoFecha = new Date(r.fecha_tiempo);
    const diffHoras = Math.floor((now - reclamoFecha) / (1000 * 60 * 60));

    let filaClase = '';
    if (diffHoras > 72 && r.estado !== 'COMPLETADO') filaClase = 'bg-red text-white';
    else if (diffHoras > 48 && r.estado !== 'COMPLETADO') filaClase = 'bg-orange';
    else if (diffHoras > 24 && r.estado !== 'COMPLETADO') filaClase = 'bg-yellow';

    const rSerialized = serializeBigInt(r);
    return {
      ...rSerialized,
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