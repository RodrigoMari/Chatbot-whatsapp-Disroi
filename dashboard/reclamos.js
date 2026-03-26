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
let { estado, area: responsable, cliente } = req.query;
  const filtro = { AND: [] };

  // Separo por comas los valores del filtro
  if (estado && typeof estado === 'string') {
    estado = estado.split(',');
  }
  if (responsable && typeof responsable === 'string') {
    responsable = responsable.split(',');
  }

  // Filtro de estado
  if (estado) {
    const estadosArray = Array.isArray(estado) ? estado : [estado];
    filtro.AND.push({ estado: { in: estadosArray } });
  }

  if (cliente) {
    filtro.AND.push({
      OR: [
        { cliente: { contains: cliente } }, // Busca en el código de cliente
        { maestro_21: { nombre: { contains: cliente } } } // Busca en el nombre
      ]
    });
  }

  // Filtro de responsable
  if (responsable) {
    const respArray = Array.isArray(responsable) ? responsable : [responsable];
    const areasFisicasDisponibles = ["DEPOSITO", "ADMINISTRACION", "RRHH"];
    const seleccionAreas = respArray.filter(r => areasFisicasDisponibles.includes(r));
    const seleccionSupervisores = respArray.filter(r => !areasFisicasDisponibles.includes(r));

    const condicionesResponsable = [];

    if (seleccionAreas.length > 0) {
      condicionesResponsable.push({
        reclamo_area: { some: { area: { in: seleccionAreas } } }
      });
    }

    if (seleccionSupervisores.length > 0) {
      const sups = await prisma.supervisor.findMany({
        where: { nombre: { in: seleccionSupervisores } },
        include: { vendedor: true }
      });

      if (sups.length > 0) {
        sups.forEach(s => {
          const codigos = s.vendedor.map(v => v.codigo);
          condicionesResponsable.push({
            AND: [
              { maestro_21: { vendedor_1: { in: codigos } } },
              { reclamo_area: { some: { area: { contains: 'VENTAS' } } } }
            ]
          });
        });
      }
    }

    if (condicionesResponsable.length > 0) {
        filtro.AND.push({ OR: condicionesResponsable });
    }
  }

  const queryFinal = filtro.AND.length > 0 ? filtro : {};

  const [reclamos, vendedores] = await Promise.all([
    prisma.reclamo.findMany({
      orderBy: { id: 'desc' },
      where: queryFinal,
      include: {
        maestro_21: true,
        reclamo_area: true
      },
    }),
    prisma.vendedor.findMany({
      include: { supervisor: true }
    })
  ]);

  const now = new Date();
  const reclamosSerializados = reclamos.map(r => {
    const datosVendedor = vendedores.find(v => v.codigo === r.maestro_21?.vendedor_1);
    const nombreSupervisor = datosVendedor?.supervisor?.nombre || "SIN SUPERVISOR";

    const telefonoVendedor = datosVendedor?.telefono;
    const telefonoCliente = "+" + r.maestro_21?.telefono;
    const telefonoClienteConVendedor = telefonoCliente === telefonoVendedor ? `${telefonoCliente}  (${datosVendedor?.codigo})` : telefonoCliente;
    let truncatedText = r.observacion.slice(0, 100);
    if (r.observacion.length > 100) truncatedText += "...";

    const reclamoFecha = new Date(r.fecha_tiempo);
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
      filaClase,
      nombreSupervisor,
      telefonoClienteConVendedor
    };
  });

  res.render('reclamos', {
    reclamos: reclamosSerializados,
    estadoSeleccionado: estado || [],
    areaSeleccionada: responsable || [],
    clienteSeleccionado: cliente || "",
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
  const { estado, area, cliente } = req.query;
  const reclamo = await prisma.reclamo.findUnique({
    where: { id },
    include: { paso: true, maestro_21: true, reclamo_area: true }
  });
  if (!reclamo) return res.status(404).send("Reclamo no encontrado");

  res.render("reclamo_detalle", { 
    reclamo,
    filtros: { estado, area, cliente } 
  });
});


router.post('/:id/agregar-paso', upload.array('foto', 2), async (req, res) => {
  try {
    const { tipo, descripcion, endpoint, area, resolucion } = req.body;
    const reclamoId = parseInt(req.params.id);
    let fotoPaths = [];
    if (req.files && req.files.length > 0) {
      fotoPaths = req.files.map(file => '/uploads/' + file.filename);
    }

    await prisma.paso.create({
      data: {
        reclamoId: reclamoId,
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

    const reclamoData = await prisma.reclamo.findUnique({ where: { id: reclamoId }, include: { maestro_21: true } });
    const v = await prisma.vendedor.findFirst({ where: { codigo: reclamoData.maestro_21?.vendedor_1 }, include: { supervisor: true } });
    const supervisorNombre = v?.supervisor?.nombre;

    if (tipo !== "FINALIZACION" && reclamoData?.tipo !== "Nuevo cliente") {
        const responsable = (area === 'VENTAS' && supervisorNombre) ? supervisorNombre : area;
        await enviarNotificacion([responsable], reclamoData.id, `${responsable} - Nuevo paso "${tipo}" en reclamo #${reclamoId}: ${descripcion.substring(0, 50)}...`);
    }
    res.redirect(`/reclamos/${req.params.id}`)
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