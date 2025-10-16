const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();
const PDFDocument = require('pdfkit');
const multer = require('multer');
const { enviarNotificacion } = require("../src/send_notifications.js");

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

function serializeBigInt(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

function calcularHorasHabiles(fechaInicio, fechaFin) {
    let totalHoras = 0;
    let fecha = new Date(fechaInicio);

    while (fecha < fechaFin) {
        const dia = fecha.getDay();
        if (dia !== 0 && dia !== 6) {
            totalHoras += 1;
        }
        fecha.setHours(fecha.getHours() + 1);
    }

    return totalHoras;
}

async function marcarEnProceso(id, endpoint, io) {
  const suscriptor = await prisma.suscripciones.findFirst({ where: { endpoint } });

  await prisma.reclamo.update({
    where: { id },
    data: {
      estado: 'EN_PROCESO'
    }
  });
  io.emit("estadoActualizado", { id, nuevoEstado: "EN_PROCESO" });
}

async function marcarCompletado(id, endpoint, io, resolucion) {
  const suscriptor = await prisma.suscripciones.findFirst({ where: { endpoint } });

  await prisma.reclamo.update({
    where: { id },
    data: {
      estado: 'COMPLETADO',
      tomado_por: suscriptor?.nombre,
      fecha_tomado: new Date(),
      info_resolucion: resolucion
    }
  });

  io.emit("estadoActualizado", { id, nuevoEstado: "COMPLETADO" });
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
    let truncatedText = r.observacion.slice(0, 100);
    if (r.observacion.length > 100) truncatedText += "...";

    const reclamoFecha = new Date(r.fecha_tiempo);
    const diffMs = now - reclamoFecha;
    const diffHoras = diffMs / (1000 * 60 * 60);

    const horasHabiles = calcularHorasHabiles(reclamoFecha, now);

    let filaClase = '';
    if (horasHabiles > 72 && r.estado !== 'COMPLETADO') filaClase = 'bg-red text-white';
    else if (horasHabiles > 48 && r.estado !== 'COMPLETADO') filaClase = 'bg-orange';
    else if (horasHabiles > 24 && r.estado !== 'COMPLETADO') filaClase = 'bg-yellow';

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

router.get('/reporte', async (req, res) => {
  const { fecha_desde, fecha_hasta } = req.query;

  // Traemos reclamos con sus áreas
  const reclamos = await prisma.reclamo.findMany({
    where: {
      fecha_tiempo: {
        gte: new Date(fecha_desde),
        lte: new Date(fecha_hasta),
      }
    },
    include: {
      reclamo_area: true
    }
  });

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="reporte.pdf"');
  doc.pipe(res);

  // Título
  doc.fontSize(20).text('Reporte de Reclamos', { align: 'center', underline: true });
  doc.moveDown();
  doc.fontSize(12).text(`Fecha desde: ${fecha_desde}    Fecha hasta: ${fecha_hasta}`, { align: 'center' });
  doc.moveDown(2);

  // Agrupar por área y estado
  const areas = {};
  const reclamosContados = new Set();

  reclamos.forEach(r => {
    reclamosContados.add(r.id);

    r.reclamo_area.forEach(ra => {
      const areaNombre = ra.area || 'Sin área';
      if (!areas[areaNombre]) areas[areaNombre] = { total: 0, estados: {}, personas: {} };

      areas[areaNombre].total++;
      areas[areaNombre].estados[r.estado] = (areas[areaNombre].estados[r.estado] || 0) + 1;

      // Si el reclamo está COMPLETADO, contar por persona
      if (r.estado === 'COMPLETADO') {
        const persona = r.tomado_por || 'Sin asignar';
        if (!areas[areaNombre].personas[persona]) areas[areaNombre].personas[persona] = 0;
        areas[areaNombre].personas[persona]++;
      }
    });
  });

  const totalReclamos = reclamosContados.size;

  for (const [area, data] of Object.entries(areas)) {
    doc.rect(doc.x - 10, doc.y, 500, 20).fill('#f0f0f0');
    doc.fillColor('black').fontSize(14).text(`Área: ${area}`, { continued: true });
    doc.fontSize(12).text(` Total: ${data.total} (${((data.total / totalReclamos) * 100).toFixed(2)}% del total)`);
    doc.moveDown(0.5);

    for (const [estado, cant] of Object.entries(data.estados)) {
      doc.fillColor('blue').fontSize(12).text(` - Estado ${estado}: ${cant}`);

      if (estado === 'COMPLETADO') {
        for (const [persona, cantidad] of Object.entries(data.personas)) {
          doc.fillColor('#555555').fontSize(11).text(`    - ${persona}: ${cantidad}`);
        }
      }
    }

    doc.moveDown();
  }


  doc.end();
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

    const filePath = path.join(__dirname, '..', reclamo.archivoPdf);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Archivo PDF no encontrado en el servidor');
    }

    const fileBuffer = fs.readFileSync(filePath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reclamo-${id}.pdf"`);
    res.send(fileBuffer);
    
  } catch (err) {
    console.error('Error al descargar PDF:', err);
    res.status(500).send('Error al descargar PDF');
  }
});

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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reclamo-${id}.pdf"`);

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

// Mostrar reclamo + pasos
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const reclamo = await prisma.reclamo.findUnique({
    where: { id },
    include: { paso: true, maestro_21: true, reclamo_area: true }
  });
  if (!reclamo) return res.status(404).send("Reclamo no encontrado");

  res.render("reclamo_detalle", { reclamo });
});


router.post('/:id/agregar-paso', upload.single('foto'), async (req, res) => {
  try {
    const { tipo, descripcion, endpoint, area, resolucion } = req.body;
    let fotoPaths = [];
    if (req.file) {
      fotoPaths = ['/uploads/' + req.file.filename];
    }

    await prisma.paso.create({
      data: {
        reclamoId: parseInt(req.params.id),
        tipo: tipo,
        descripcion: descripcion,
        fecha: new Date(),
        persona: (await prisma.suscripciones.findFirst({ where: { endpoint } })).nombre,
        area_paso: (await prisma.suscripciones.findFirst({ where: { endpoint } })).area,
        foto: fotoPaths.length > 0 ? fotoPaths.join(',') : null,
      }
    });

    let areaValue = null;

    if (tipo === "ANALISIS" || tipo === "INFORMACION") {
      await marcarEnProceso(req.params.id, endpoint, req.io);
    } else if (tipo === "FINALIZACION") {
      await marcarCompletado(req.params.id, endpoint, req.io, resolucion);
      const suscripcion = await prisma.suscripciones.findFirst({ where: { endpoint } });
      areaValue = suscripcion?.area || null;
    }

    await prisma.reclamo_area.deleteMany({
      where: { reclamo_Id: parseInt(req.params.id) }
    });

    await prisma.reclamo_area.create({
      data: {
        reclamo_Id: parseInt(req.params.id),
        ...((tipo === "ANALISIS" || tipo === "INFORMACION") && { area: area }),
        ...(tipo === "FINALIZACION" && { area: areaValue }),
      }
    });

    await enviarNotificacion([area], `Tiene un nuevo paso de resolución de tipo ${tipo} en reclamo #${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al guardar paso');
  }
});


// Estos eran los cambios de estado, cambie la modalidad pero los dejo por si me sirven en el futuro
/*
router.post('/resolver/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { endpoint } = req.body;

  await prisma.reclamo.update({
    where: { id },
    data: {
      estado: 'COMPLETADO',
      tomado_por: (await prisma.suscripciones.findFirst({ where: { endpoint } })).nombre,
      fecha_tomado: new Date()
    }
  });

  await req.io.emit("estadoActualizado", { id, nuevoEstado: "COMPLETADO" });

  res.redirect(`/reclamos/${id}`);
});

router.post('/en_proceso/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { endpoint } = req.body;

    await prisma.reclamo.update({
      where: { id },
      data: {
        estado: 'EN_PROCESO',
        tomado_por: (await prisma.suscripciones.findFirst({ where: { endpoint } })).nombre,
        fecha_tomado: new Date()
      }
    });

    await req.io.emit("estadoActualizado", { id, nuevoEstado: "EN_PROCESO" });

  res.redirect(`/reclamos/${id}`);
});

router.post('/pendiente/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  await prisma.reclamo.update({
      where: { id },
      data: {
        estado: 'PENDIENTE',
        tomado_por: null,
        fecha_tomado: null
      }
    });

  res.redirect('/reclamos');
});

router.post('/info-resolucion/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { info_resolucion } = req.body;

  await prisma.reclamo.update({
    where: { id },
    data: { info_resolucion }
  });

  res.redirect('/reclamos');
});
*/





module.exports = router;