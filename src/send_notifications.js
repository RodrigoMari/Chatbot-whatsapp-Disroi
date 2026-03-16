const { PrismaClient } = require("@prisma/client");
require("dotenv").config();
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:rodrigojuanmari@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const prisma = new PrismaClient();

async function enviarNotificacion(areas, mensaje = "Reclamo en estado pendiente", ) {
    const payload = JSON.stringify({
        title: 'Nuevo reclamo',
        body: mensaje,
        url: `${process.env.BASE_URL}`
    });
    
    const subs = await prisma.suscripciones.findMany({
        where: {
            area: { in: areas }
        }
    });

    for (const sub of subs) {
        const pushSub = {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime,
            keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
            }
        };

        try {
            await webpush.sendNotification(pushSub, payload);
        } catch (err) {
            console.error("Error enviando notificación:", err);

            if (err.statusCode === 410 || err.statusCode === 404) {
                await prisma.suscripciones.delete({
                    where: { id: sub.id }
                });
                console.log(`Suscripción eliminada (endpoint inválido): ${sub.endpoint}`);
            }
        }
    }
}

function horasHabiles(fechaInicio, fechaFin) {
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


async function enviarNotificacionesVencidas() {
  const ahoraUTC = new Date();
  const hace24hUTC = new Date(ahoraUTC.getTime() - 24 * 60 * 60 * 1000);
  const hace48hUTC = new Date(ahoraUTC.getTime() - 48 * 60 * 60 * 1000);
  const hace72hUTC = new Date(ahoraUTC.getTime() - 72 * 60 * 60 * 1000);

  try {
    // Traemos todos los reclamos pendientes
    const reclamos = await prisma.reclamo.findMany({
      where: { estado: "PENDIENTE", fecha_tiempo: { lt: hace24hUTC } },
      select: { id: true, fecha_tiempo: true }
    });

    if (reclamos.length === 0) {
      console.log("→ No hay reclamos pendientes para notificar.");
      return;
    }

    const reclamoIds = reclamos.map(r => r.id);

    const areas = await prisma.reclamo_area.findMany({
      where: { reclamo_Id: { in: reclamoIds } },
      select: { reclamo_Id: true, area: true }
    });

    const porArea = {};
    const mapReclamos = {};

    areas.forEach(a => {
      const area = a.area.trim().toUpperCase();
      const reclamo = reclamos.find(r => r.id === a.reclamo_Id);
      if (!reclamo) return;

    const diffHorasHabiles = horasHabiles(reclamo.fecha_tiempo, ahoraUTC);

      let rango = null;
      if (diffHorasHabiles >= 72) {
        rango = "72";
      } else if (diffHorasHabiles >= 48) {
        rango = "48";
      } else if (diffHorasHabiles >= 24) {
        rango = "24";
      }

      if (rango) {
        const key = `${area}-${a.reclamo_Id}-${rango}`;
        if (!mapReclamos[key]) {
          if (!porArea[area]) {
            porArea[area] = { "24": 0, "48": 0, "72": 0 };
          }
          porArea[area][rango]++;
          mapReclamos[key] = true;
        }
      }
    });

    // Enviar notificaciones por área
    for (const [area, rangos] of Object.entries(porArea)) {
      const mensaje = `📢 El área ${area} tiene:
      - ${rangos["24"]} reclamos pendientes de más de 24h
      - ${rangos["48"]} reclamos pendientes de más de 48h
      - ${rangos["72"]} reclamos pendientes de más de 72h`;

      console.log("→ Enviando notificación:", mensaje);
      await enviarNotificacion([area], mensaje);
    }
  } catch (error) {
    console.error("❌ Error al enviar notificaciones:", error);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { 
    enviarNotificacionesVencidas,
    enviarNotificacion
};
