const express = require('express');
const twilio = require('./twilio.js');
const { PrismaClient } = require('@prisma/client');
const http = require("http");
const fs = require('fs');
const cron = require("node-cron");
const { enviarNotificacionesVencidas, enviarNotificacion } = require("./send_notifications.js");
const { Server } = require("socket.io");


const prisma = new PrismaClient();
const estados = {};
const app = express();

const allowedIPs = [
    '179.60.217.196',
    '181.92.200.67',
    '186.182.43.30',
    '186.182.43.30',
    '181.92.200.11',
];

app.set('trust proxy', true);

//Chequear lista de IPs permitidas
const checkIPWhitelist = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    const cleanIP = clientIP.replace(/^::ffff:/, '');
    
    //console.log('IP del cliente:', cleanIP);
    if (allowedIPs.includes(cleanIP)) {
        return next();
    }
    
    return res.status(403).send('Acceso denegado - IP no autorizada');
};

const path = require('path');

const soynosoyuser = "HX9e184160bf10f041ed5747ae4db5d422"
const nosoycliente = "HXf7ce18d882ee63a3c0e46552b2bf1e12"

const main = "HX6870b1d969384339885c8fa36ad104b0"

const reclamo = "HXc094d32314dc5bd4015d8bbdb3cc3fc1"
const pedido = "HX25d7f54ba8b3d54d947652ffac9b8703"
const sobreNosotros = "HXfc73d64a5f842aded7fac0af5d082fff"

const noLlegó = "HX0cba42d4b6fdc98e57f029ad7df3b574";

app.use((req, res, next) => {
  req.io = io;
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Enviar notificaciones a las 24, 48 y 72 horas
cron.schedule("0 12 * * *", async () => {
  console.log("⏰ Ejecutando envío de notificaciones de reclamos pendientes >24h...");
  await enviarNotificacionesVencidas();
}, {
  scheduled: true,
  timezone: "America/Argentina/Buenos_Aires"
});

async function identificarUsuario(waId, body) {
    //busqueda por codigo de cliente
    if(body.length < 8){
        let codigoCeros = body
        for (let i = 0; i < 10 - body.length; i++) {
            codigoCeros = '0' + codigoCeros;
        }
        const cliente = await prisma.maestro_cliente.findFirst({where: {codigo: codigoCeros}});
        if (cliente){
            estados[waId] = { identificado: true, cliente_id: cliente.codigo };
        }
    }
    //busqueda por dni
    else{
        const dniIngresado = body;
        const cliente = await prisma.$queryRaw`
            SELECT * FROM maestro_cliente
            WHERE dni = ${dniIngresado}
            OR SUBSTRING_INDEX(SUBSTRING_INDEX(cuit, '-', 2), '-', -1) = ${dniIngresado}
        `;
        if (cliente.length > 0) {
            //await twilio.sendMessage(waId, `Hola ${cliente[0].nombre}`);
            estados[waId] = { identificado: true, cliente_id: cliente[0].codigo };
        }
    }

}
app.post('/webhook', async (req, res) => {
    const waId = req.body.WaId;
    const body = req.body.Body;
    const ListTitle = req.body.ListTitle;
    
    if (estados[waId]?.paso === 'guardar') {
        const datos = estados[waId];
        let archivoPdfPath = null;
        if (req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
            const mediaUrl = req.body.MediaUrl0;
            const fileName = `${Date.now()}-${waId}.pdf`;
            const filePath = path.join(__dirname, "../uploads", fileName);

            const axios = require("axios");
            try {
                const response = await axios.get(mediaUrl, {
                    responseType: "arraybuffer",
                    auth: {
                        username: process.env.TWILIO_ACCOUNT_SID,
                        password: process.env.TWILIO_AUTH_TOKEN
                    }
                });
                fs.writeFileSync(filePath, response.data);
                archivoPdfPath = "uploads/" + fileName;
            } catch (err) {
                console.error("Error descargando PDF:", err);
            }
        }

        if(datos.tipo === 'Nuevo cliente') {
            datos.observacion = datos.observacion + "\nObservación: " + body;
        }

        if(datos.tipo === 'Me falta un producto' || datos.tipo === 'Solicitud NDC') {
            datos.observacion = datos.observacion + "\nObservación: " + body;
        }

        //console.log("Datos del reclamo:", datos);
        try {
            await prisma.reclamo.create({
                data: {
                    cliente: datos.cliente_id || null,
                    tipo: datos.tipo,
                    reclamo_area: {
                        create: datos.area.map((area) => ({
                            area: area,
                        })),
                    },
                    cod_factura: parseInt(datos.cod_factura, 10) || null,
                    estado: 'PENDIENTE',
                    archivoPdf: archivoPdfPath || null,
                    observacion: datos.observacion || body,
                }
            });
            enviarNotificacion(datos.area, `Reclamo "${datos.tipo}" de cliente ID "${datos.cliente_id || "No identificado"}"`);
            if(datos.cliente_id) {
                    const cliente = await prisma.maestro_cliente.findFirst({where: { codigo: datos.cliente_id }});
                    if (cliente) {
                        twilio.sendMessage(waId, "✅ *" + (cliente.nombre || " ") + "*, Gracias por comunicar tu reclamo referido a *" + datos.tipo + "*. En las próximas 72hs recibirá una respuesta por parte del/los responsable/s.");
                    }
            } else {
                twilio.sendMessage(waId, `✅ Gracias por comunicar tu reclamo referido a *${datos.tipo}*. En las próximas 72hs recibirá una respuesta por parte del/los responsable/s.`);
            }

            delete estados[waId];
            return;
        } catch (error) {
            console.error('Error al guardar reclamo:', error);
            await twilio.sendMessage(waId, "❌ Ocurrió un error al guardar su reclamo. Por favor, intente nuevamente.");
        }
        
    }

    //Mensaje de bienvenida
    if (!estados[waId]) {
        console.log("Nuevo usuario:", req.body);
        if (req.body.MessageType === 'interactive') {
            switch(body) {
                case 'Soy cliente':
                    estados[waId] = { paso: 'soycliente' };
                    break;
                case 'No soy cliente | CV':
                    estados[waId] = { paso: 'nosoycliente' };
                    break;
            }
        }
        else {
            twilio.sendListPicker(waId, soynosoyuser);
            return;
        }
                 
    }

    //Identificación del usuario
    if (estados[waId].paso === 'esperando_identificacion') {
        await identificarUsuario(waId, body);
        if (estados[waId].identificado) {
            estados[waId].paso = 'flujo';
        } else {
            twilio.sendMessage(waId, 
                "​🙅‍♂️​ No he podido identificarlo ​🙅‍♂️\n\n" + 
                "Por favor, intente nuevamente. Asegúrese de ingresar solo su *código de cliente* (sin ceros) o *número de documento*"
            );
        }
    }

    if (estados[waId].paso === 'soycliente') {
        await twilio.sendMessage(waId,
            "⭐ Estoy encantado de tenerlo en el equipo de *Disroi*\n\n" +
            "Para comenzar, le solicito que me brinde su *código de cliente* (sin ceros) o su *número de documento* para su correcta identificación\n\n"
        );

        estados[waId].paso = 'esperando_identificacion';
    }

    if(estados[waId].paso === 'esperando_nombre') {
        estados[waId].nombre = body;
        estados[waId].registro = "nombre";
        estados[waId].paso = 'registrarcomercio';
    }

    if(estados[waId].paso === 'esperando_direccion') {
        estados[waId].direccion = body;
        estados[waId].registro = "direccion";
        estados[waId].paso = 'registrarcomercio';
    }

    if(estados[waId].paso === 'esperando_telefono') {
        estados[waId].telefono = body;

        const observacion = `*Nombre*: ${estados[waId].nombre}\n` +
                    `*Dirección*: ${estados[waId].direccion}\n` +
                    `*Teléfono*: ${estados[waId].telefono}`;
        await twilio.sendMessage(waId,
            "⭐​ Resumen de su información:\n" + 
            observacion + 
            "\n\nPara finalizar, le pido que escriba cualquier *observación* adicional sobre su negocio"
        );
        estados[waId] = {
            tipo: 'Nuevo cliente',
            area: ['VENTAS', 'ADMINISTRACION'],
            paso: 'guardar',
            observacion: observacion,
        };
    }

    if(estados[waId].paso === 'nosoycliente') {
        if (req.body.ButtonText !== 'No soy cliente | CV') {
            switch(body) {
                case 'Registrar comercio':
                    estados[waId] = { paso: 'registrarcomercio' };
                    break;
                case 'Entregar curriculum':
                    estados[waId] = { paso: 'curriculum' };
                    break;
                case 'Volver al menú anterior':
                    twilio.sendListPicker(waId, soynosoyuser);
                    break;
            }

        }
        else {
            twilio.sendListPicker(waId, nosoycliente);
            return;
        }

    }

    if(estados[waId].paso === 'curriculum') {
        await twilio.sendMessage(waId,"Me enorgullese que quieras formar parte de *Disroi*\n\n" +
            "📄 Por favor, envíe su *currículum* en formato PDF, además de cualquier información que quieras agregar (maximo 300 caracteres)\n\n" +
            "💡 Asegúrese de enviar todo en 1 solo mensaje"
        );
        estados[waId] = {
            tipo: 'Solicitud de trabajo',
            area: ['RRHH'],
            paso: 'guardar',
        };
    }

    if(estados[waId].paso === 'registrarcomercio') {
        console.log("Nuevo comercio:", req.body);
        if (!estados[waId].registro) {
            estados[waId].registro = "";
        }

        switch (estados[waId].registro) {
            case "direccion":
                await twilio.sendMessage(waId,
                    "📞 Proporcione su *teléfono de contacto*\n\n" +
                    "Tenga en cuenta que es el número con el cual se comunicará el vendedor, asegúrese de incluir el código de país y de área."
                );
                estados[waId].registro = "telefono";
                estados[waId].paso = 'esperando_telefono';
                break;
            case "nombre":
                await twilio.sendMessage(waId,
                    "🏢 Ahora suministre la *dirección de su negocio*\n\n" +
                    "Considere que es la dirección a la cual se acercará el vendedor, asegúrese de incluir todos los detalles necesarios"
                );
                estados[waId].registro = "direccion";
                estados[waId].paso = 'esperando_direccion';
                break;
            case "":
                await twilio.sendMessage(waId,
                    "🥺 Lamento mucho que no seas parte de *Disroi*, sin embargo, estoy aquí para registrarte\n\n" +
                    "Te notifico que nuestra zona de atención esta delimitada (teniendo en cuenta solo las manos internas en dichos límites):\n\n" +
                    "↔️​​ *Oeste a este*: Oroño y Av. Belgrano\n" +
                    "↕️ *De norte a sur*: Av. Wheelwright y Batlle y Ordóñez\n\n" +
                    "Comience brindándome su *nombre completo* o *razón social* con la cual quiere que lo identifiquemos, si no se encuentra en nuestra zona, ignorar este proceso"
                );
                estados[waId].registro = "nombre";
                estados[waId].paso = 'esperando_nombre';
                break;
        }
    }

    if (estados[waId]?.paso === 'productos') {
        twilio.sendMessage(waId, "Perfecto. Ahora, por favor, escriba alguna *observación* que nos pueda dar contexto de la situación (máximo 300 caracteres).");
        estados[waId] = {
            ...estados[waId],
            paso: 'guardar',
            observacion: "Productos: " + body,
        };
    }

    if (estados[waId]?.paso === 'factura') {
        if(body.length > 6 || body.length < 5) {
            twilio.sendMessage(waId, "❌ El código de factura debe tener 5 o 6 caracteres.\n\n"
                + "💡​ Recuerde, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");
            return;
        }

        switch (estados[waId]?.tipo) {
            case 'Me falta un producto':
                twilio.sendMessage(waId, "Para terminar de registrar su reclamo le pido que nos comunique, en 1 solo mensaje, qué *productos* faltan.\n\n"
                    + "💡​ Por favor, mencione los códigos de producto especificados en la factura para que no haya confusión");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'productos',
                    cod_factura: body,
                };
                break;

            case 'Solicitud NDC':
                twilio.sendMessage(waId, "Para terminar de registrar su reclamo le pido que nos comunique, en 1 solo mensaje, qué *productos* son los implicados.\n\n"
                    + "💡 Por favor, mencione solo los códigos de productos a los que le falta la nota de crédito.");

                estados[waId] = {
                    ...estados[waId],
                    paso: 'productos',
                    cod_factura: body,
                };
                break;

            default:
                twilio.sendMessage(waId, "Perfecto. Ahora, por favor, escriba alguna observación que nos pueda dar contexto de la situación (máximo 300 caracteres).");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'guardar',
                    cod_factura: body,
                };
        }
    }

    //Flujo principal
    if (estados[waId].paso === 'flujo') {

        //main
        if (req.body.MessageType != 'interactive') {
            
            if(req.body.Body === 'lechuza') {
                twilio.sendMessage(waId, "piashins piashins");
            }
            else
                prisma.maestro_cliente.findFirst({where: { codigo: estados[waId].cliente_id }
                    }).then(async cliente => {
                        if (cliente) {
                            await twilio.sendListPicker(waId, main, {1: cliente.nombre});
                        }
                    });
        }

        //1er seccion
        console.log("req ->", req.body);
        switch (body) {
            case 'Reclamos':
                twilio.sendListPicker(waId, reclamo);
                break;
            case 'Pedidos':
                twilio.sendListPicker(waId, pedido);
                break;
            case 'Acerca de nosotros':
                twilio.sendListPicker(waId, sobreNosotros);
                break;
        }
        //reclamos
        switch (ListTitle) {
            case 'No llegó mi pedido':
                twilio.sendMessage(waId, "📜​ Para continuar, por favor, escribe el *codigo de factura* de *5 o 6 dígitos (sin ceros)* referido a esta diferencia\n\n"
                    + "💡​ Como dato, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");
                
                estados[waId] = {
                    ...estados[waId],
                    paso: 'factura',
                    tipo: ListTitle,
                    area: ['DEPOSITO', 'GC'],
                };

                break;
            case 'Me falta un producto':
                twilio.sendMessage(waId, "📜​ Para continuar, por favor, escribe el *codigo de factura* de *5 o 6 dígitos (sin ceros)* referido a esta diferencia\n\n"
                    + "💡​ Como dato, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");

                estados[waId] = {
                    ...estados[waId],
                    paso: 'factura',
                    tipo: ListTitle,
                    area: ['DEPOSITO', 'GC'],
                };
                break;
            case 'Mi vendedor no me visitó':
                twilio.sendMessage(waId, "🙏​ Le pedimos disculpas de parte del equipo de Disroi\n\n"
                            + "⬇️​ Para terminar, escriba alguna observación que nos pueda dar contexto de la situación.");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'guardar',
                    tipo: ListTitle,
                    area: ['VENTAS', 'GC'],
                };

                break;

            case 'Diferencia en CC':
                twilio.sendMessage(waId, "📜 Para continuar, por favor, escribe el *codigo de factura* de *5 o 6 dígitos (sin ceros)* referido a esta diferencia\n\n"
                    + "💡 Como dato, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'factura',
                    tipo: ListTitle,
                    area: ['ADMINISTRACION', 'GC'],
                };
                break;
            case 'Solicitud NDC':
                twilio.sendMessage(waId, "📜 Para continuar, por favor, escribe el *codigo de factura* de *5 o 6 dígitos (sin ceros)* para hacer la nota de crédito\n\n"
                    + "💡 Como dato, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'factura',
                    tipo: ListTitle,
                    area: ['ADMINISTRACION', 'VENTAS', 'GC'],
                };
                break;
            case 'Requiero atención':
                let mensaje = "";
                prisma.maestro_cliente.findFirst({where: { codigo: estados[waId].cliente_id }
                }).then(async cliente => {
                    if (cliente) {
                        let vendedor1 = await prisma.vendedor.findFirst({where: { codigo: cliente.vendedor_1 }});
                        let vendedor2 = await prisma.vendedor.findFirst({where: { codigo: cliente.vendedor_2 }});
                        if(vendedor1?.telefono && vendedor1?.nombre){
                            mensaje += "Debido a la alta demanda, le pedimos que se comunique con sus vendedores designados:\n\n";
                            mensaje += `${vendedor1.nombre}: ${vendedor1.telefono}\n\n`;
                            if(vendedor2?.telefono != null)
                                mensaje += `${vendedor2.nombre}: ${vendedor2.telefono}\n\n`;
                        mensaje += "Si de igual manera quiere comunicarse con un superior, escriba alguna observación que nos pueda dar contexto de la situación.";
                        await twilio.sendMessage(waId, mensaje);
                        } else {
                            await twilio.sendMessage(waId, "⬇️ Estoy aquí para ayudarte, por favor, especifique su consulta para registrar el reclamo. Su caso sera atendido por un responsable");
                        }
                    }
                });

                estados[waId] = {
                    ...estados[waId],
                    paso: 'guardar',
                    tipo: ListTitle,
                    area: ['VENTAS', 'GC'],
                };

                break;
            case 'Reclamo alternativo':
                twilio.sendMessage(waId, "🚀 Estoy en constante mejora para una mejor atención\n\n"
                            + "Registre su reclamo escribiendo sus inconvenientes, si el reclamo es recurrente, será agregado al flujo en el futuro");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'guardar',
                    tipo: ListTitle,
                    area: ['VENTAS', 'ADMINISTRACION', 'DEPOSITO', 'GC'],
                };
                break;
        }

        switch (ListTitle) {
            case 'Tokin':
                twilio.sendMessage(waId, "Para llevar a cabo su pedido por *Tokin*, visite la tienda oficial de *Disroi*: https://www.tokintienda.com/");
                break;
            case 'Manual':
                let mensaje = "";
                prisma.maestro_cliente.findFirst({where: { codigo: estados[waId].cliente_id }
                }).then(async cliente => {
                    if (cliente) {
                        let vendedor1 = await prisma.vendedor.findFirst({where: { codigo: cliente.vendedor_1 }});
                        let vendedor2 = await prisma.vendedor.findFirst({where: { codigo: cliente.vendedor_2 }});
                        if(vendedor1?.telefono && vendedor1?.nombre){
                            mensaje += "Le pedimos que para concretar su pedido de manera manual se comunique con alguno de sus vendedores desginados:\n\n";
                            mensaje += `${vendedor1.nombre}: ${vendedor1.telefono}\n\n`;
                            if(vendedor2?.telefono != null)
                                mensaje += `${vendedor2.nombre}: ${vendedor2.telefono}\n\n`;
                        await twilio.sendMessage(waId, mensaje);
                        } else {
                            await twilio.sendMessage(waId, "No tiene vendedores designados, le recomiendo que haga su pedido por nuestra tienda oficial de *Disroi*: https://www.tokintienda.com/");
                        }
                    }
                });

                break;
            case 'Ver ofertas':
                await twilio.sendMessage(waId, "Actualmente *Disroi* no tiene ofertas disponibles para ofrecerte, sepa disculparnos");
                twilio.sendListPicker(waId, main);
                break;
        }
        //volver al menu principal
        switch (ListTitle) {
            case 'Volver al menú anterior':
                twilio.sendListPicker(waId, main);
                break;
        }
    }
    res.status(200).send('OK');
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../dashboard'));
app.use(express.static(path.join(__dirname, '../dashboard')), checkIPWhitelist);
app.use(express.static(path.join(__dirname, '../public')));
const reclamosRouter = require('../dashboard/reclamos.js');
app.use('/reclamos', checkIPWhitelist, reclamosRouter);


async function saveSubscription(sub) {
  await prisma.suscripciones.create({
    data: {
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime ? new Date(sub.expirationTime) : null,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      area: sub.area,
      nombre: sub.nombre,
      ip: sub.ip
    }
  });
}

app.get('/check-subscription', async (req, res) => {
    try {
        const { endpoint } = req.query;
        
        if (!endpoint) {
        return res.json({ exists: false });
        }
        
        const exists = await prisma.suscripciones.findFirst({
        where: {
            endpoint: endpoint
        }
    });

    res.json({ exists: !!exists });
  } catch (err) {
    console.error(err);
    res.json({ exists: false });
  }
});

app.get('/vapidPublicKey', checkIPWhitelist, (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

app.post('/subscribe', checkIPWhitelist, express.json(), async (req, res) => {
  const { subscription, area, nombre } = req.body;
  const clientIP = req.ip?.replace(/^::ffff:/, '') || null;

  const exists = await prisma.suscripciones.findFirst({
    where: {
      endpoint: subscription.endpoint
    }
  });

  if (!exists) {
    const newSub = {
      ...subscription,
      area,
      nombre,
      ip: clientIP
    };

    //subscriptions.push(newSub);
    saveSubscription(newSub);
    console.log('✅ Nueva suscripción guardada');
  } else {
    console.log('ℹ️ Suscripción ya existente (no se duplica)');
  }

  const totalSuscripciones = await prisma.suscripciones.count();
  console.log(`Total de suscripciones: ${totalSuscripciones}`);
  res.status(201).json({});
});

module.exports = { enviarNotificacion };


//const httpsServer = https.createServer(options, app);
//const io = new Server(httpsServer, {
//  cors: {
//    origin: "*",
//  }
//});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

server.listen(3443, () => {
  console.log("Servidor HTTPS activo en puerto 3443");
});

app.listen(3000, () => {
  console.log('Servidor HTTP en puerto 3000');
});