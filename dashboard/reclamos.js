const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
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
      maestro_21: {
        select: {
          nombre: true,
          vendedor_1: true,
          vendedor_2: true,
          telefono: true
        }
      },
      reclamo_area: true
    },
  });
  
  const now = new Date();

  const reclamosSerializados = reclamos.map(r => {
    let truncatedText = r.observacion.slice(0, 30);
    if (r.observacion.length > 30) truncatedText += "...";

    const reclamoFecha = new Date(r.fecha_tiempo);
    const diffMs = now - reclamoFecha;
    const diffHoras = diffMs / (1000 * 60 * 60);

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

// Descargar PDF de un reclamo
router.get('/:id/pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const reclamo = await prisma.reclamo.findUnique({
      where: { id },
      select: { archivoPdf: true },
    });

    if (!reclamo || !reclamo.archivoPdf) {
      return res.status(404).send('PDF no encontrado');
    }

    // Build the full file path
    const filePath = path.join(__dirname, '..', reclamo.archivoPdf);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Archivo PDF no encontrado en el servidor');
    }

    // Read the file and send it
    const fileBuffer = fs.readFileSync(filePath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reclamo-${id}.pdf"`);
    res.send(fileBuffer);
    
  } catch (err) {
    console.error('Error al descargar PDF:', err);
    res.status(500).send('Error al descargar PDF');
  }
});

// Alternative approach using streams (more memory efficient for large files)
router.get('/:id/pdf-stream', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const reclamo = await prisma.reclamo.findUnique({
      where: { id },
      select: { archivoPdf: true },
    });

    if (!reclamo || !reclamo.archivoPdf) {
      return res.status(404).send('PDF no encontrado');
    }

    const filePath = path.join(__dirname, '..', reclamo.archivoPdf);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Archivo PDF no encontrado en el servidor');
    }

    // Set headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reclamo-${id}.pdf"`);
    
    // Create read stream and pipe to response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('Error streaming PDF:', err);
      res.status(500).send('Error al descargar PDF');
    });
    
  } catch (err) {
    console.error('Error al descargar PDF:', err);
    res.status(500).send('Error al descargar PDF');
  }
});

router.post('/resolver/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { endpoint } = req.body;

  await prisma.$executeRaw`
    UPDATE reclamo
    SET estado = 'COMPLETADO',
        tomado_por = (SELECT nombre FROM suscripciones WHERE endpoint = ${endpoint} LIMIT 1),
        fecha_tomado = NOW()
    WHERE id = ${id};
  `;

  res.redirect('/reclamos');
});

router.post('/en_proceso/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { endpoint } = req.body;

  await prisma.$executeRaw`
    UPDATE reclamo
    SET estado = 'EN_PROCESO',
        tomado_por = (SELECT nombre FROM suscripciones WHERE endpoint = ${endpoint} LIMIT 1),
        fecha_tomado = NOW()
    WHERE id = ${id};
  `;

  res.redirect('/reclamos');
});

router.post('/pendiente/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { endpoint } = req.body;

  await prisma.$executeRaw`
    UPDATE reclamo
    SET estado = 'PENDIENTE',
        tomado_por = NULL,
        fecha_tomado = NULL
    WHERE id = ${id};
  `;

  res.redirect('/reclamos');
});

module.exports = router;