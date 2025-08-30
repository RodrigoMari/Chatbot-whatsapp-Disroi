const express = require('express');
const twilio = require('./twilio.js');
const { ListItem } = require('twilio/lib/rest/content/v1/content.js');
const { PrismaClient } = require('@prisma/client');
const Sync = require('twilio/lib/rest/Sync.js');
const { empty } = require('@prisma/client/runtime/library');
const https = require('https');
const fs = require('fs');
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:rodrigojuanmari@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const prisma = new PrismaClient();
const estados = {};
const app = express();

const allowedIPs = [
    '179.60.217.196',  // Yo ip local
    '181.92.200.67',  // admin Fran
    '186.182.43.30',  // admin Rodri
    '186.182.43.30',  // RRHH Vir
    //'192.168.110.179',  // depo Cesar
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

//bloquear conexion de ngrok
const blockNgrokAccess = (req, res, next) => {
    //const host = req.get('host');
    
    // Si viene de ngrok, bloquear
//    if (host && host.includes('ngrok')) {
//        return res.status(403).send('Acceso denegado - Use la conexión local');
//    }
    
    // Si viene de localhost o IP local, permitir
    next();
};

const path = require('path');

const soynosoyuser = "HX9e184160bf10f041ed5747ae4db5d422"
const nosoycliente = "HXa9f819aaf4ccf4bed51bbf64d009911e"

const main = "HX6870b1d969384339885c8fa36ad104b0"

const reclamo = "HX6e0e0c38732d2da69eb30496f53f491f"
const pedido = "HX25d7f54ba8b3d54d947652ffac9b8703"
const sobreNosotros = "HXfc73d64a5f842aded7fac0af5d082fff"

const noLlegó = "HX0cba42d4b6fdc98e57f029ad7df3b574";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
            const filePath = path.join(__dirname, "uploads", fileName);

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
            datos.observacion = datos.observacion + "\nObservacion: " + body;
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

            enviarNotificacion(datos.area)
            prisma.maestro_cliente.findFirst({where: { codigo: datos.cliente_id }
                }).then(async cliente => {
                    if (cliente) {
                        twilio.sendMessage(waId, "✔️ *" + cliente.nombre + "*, gracias por comunicar tu reclamo referido a *" + datos.tipo + "*. En las próximas 72hs recibirá una respuesta por parte del/los responsable/s.");
                    }
                });


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
        estados[waId].paso = 'registrarusuario';
    }

    if(estados[waId].paso === 'esperando_direccion') {
        estados[waId].direccion = body;
        estados[waId].registro = "direccion";
        estados[waId].paso = 'registrarusuario';
    }

    if(estados[waId].paso === 'esperando_telefono') {
        estados[waId].telefono = body;

        const observacion = `*Nombre*: ${estados[waId].nombre}\n` +
                    `*Dirección*: ${estados[waId].direccion}\n` +
                    `*Teléfono*: ${estados[waId].telefono}`;
        await twilio.sendMessage(waId,
            "⭐​ Resumen de su información:\n" + 
            observacion + 
            "\n\nPara finalizar, le pido que escriba cualquier *observacion* adicional sobre su negocio"
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
                case 'Registrar usuario':
                    estados[waId] = { paso: 'registrarusuario' };
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
            "Asegúrese de enviar todo en 1 solo mensaje"
        );
        estados[waId] = {
            tipo: 'Solicitud de trabajo',
            area: ['RRHH'],
            paso: 'guardar',
        };
    }

    if(estados[waId].paso === 'registrarusuario') {
        console.log("Nuevo usuario:", req.body);
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

    if (estados[waId]?.paso === 'factura') {
        if(body.length > 6 || body.length < 5) {
            twilio.sendMessage(waId, "❌ El código de factura debe tener 5 o 6 caracteres.\n\n"
                + "💡​ Recuerde, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*.");
            return;
        }

        if(ListTitle == 'Me falta un producto') {
            twilio.sendMessage(waId, "Para termina de registrar su reclamo le pido que nos comunique, en 1 solo mensaje, qué productos faltan.\n\n"
            + "💡​ Por favor, mencione los códigos de producto especificados en la factura para que no haya confusión.");
        }
        else twilio.sendMessage(waId, "Perfecto. Ahora, por favor, escriba alguna observación que nos pueda dar contexto de la situación (máximo 300 caracteres).");

        estados[waId] = {
            ...estados[waId],
            paso: 'guardar',
            cod_factura: body,
        };
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
                    area: ['DEPOSITO'],
                };

                break;
            case 'Me falta un producto':
                twilio.sendMessage(waId, "📜​ Para continuar, por favor, escribe el *codigo de factura* de *5 o 6 dígitos (sin ceros)* referido a esta diferencia\n\n"
                    + "💡​ Como dato, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");

                estados[waId] = {
                    ...estados[waId],
                    paso: 'factura',
                    tipo: ListTitle,
                    area: ['DEPOSITO'],
                };
                break;
            case 'Mi vendedor no me visitó':
                twilio.sendMessage(waId, "🙏​ Le pedimos disculpas de parte del equipo de Disroi\n\n"
                            + "⬇️​ Para terminar, escriba alguna observación que nos pueda dar contexto de la situación.");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'guardar',
                    tipo: ListTitle,
                    area: ['VENTAS'],
                };

                break;

            case 'Diferencia en CC':
                twilio.sendMessage(waId, "📜 Para continuar, por favor, escribe el *codigo de factura* de *5 o 6 dígitos (sin ceros)* referido a esta diferencia\n\n"
                    + "💡 Como dato, las facturas de *6 digitos* corresponden a *facturas tipo A* mientras que las de *5 digitos* a *facturas tipo B*");
                estados[waId] = {
                    ...estados[waId],
                    paso: 'factura',
                    tipo: ListTitle,
                    area: ['ADMINISTRACION'],
                };
                break;
            case 'Solicitud NDC':
                //pedir codigos de productos para hacer la nota de credito
                //avisarle al vendedor directamente que no se hizo la nota de crédito
                break;
            case 'Requiero atención':
                let mensaje = "";
                prisma.maestro_cliente.findFirst({where: { codigo: estados[waId].cliente_id }
                }).then(async cliente => {
                    if (cliente) {
                        let vendedor1 = await prisma.vendedor.findFirst({where: { codigo: cliente.vendedor_1 }});
                        let vendedor2 = await prisma.vendedor.findFirst({where: { codigo: cliente.vendedor_2 }});
                        if(vendedor1?.telefono)
                            mensaje += "Debido a la alta demanda, le pedimos que se comunique con sus vendedores designados:\n\n";
                            mensaje += `${vendedor1.nombre}: ${vendedor1.telefono}\n\n`;
                            if(vendedor2?.telefono != null)
                                mensaje += `${vendedor2.nombre}: ${vendedor2.telefono}\n\n`;
                        
                        mensaje += "Si de igual manera quiere comunicarse con un superior, escriba alguna observación que nos pueda dar contexto de la situación.";
                        
                        await twilio.sendMessage(waId, mensaje);
                    }
                });

                estados[waId] = {
                    ...estados[waId],
                    paso: 'guardar',
                    tipo: ListTitle,
                    area: ['VENTAS'],
                };

                break;
        }

        switch (ListTitle) {
            case 'Tokin':
                twilio.sendMessage(waId, "Para llevar a cabo su pedido por *Tokin*, visite la tienda oficial de *Disroi*: https://www.tokintienda.com/");
                break;
            case 'Manual':
                twilio.sendMessage(waId, "Para llevar a cabo su pedido de manera *Manual* puede comunicarse con su vendedor designado. ¿Requiere su contacto?");
                break;
            case 'Ver ofertas':
                //Mostrar ofertas
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
app.set('views', path.join(__dirname, 'dashboard'));
app.use(express.static(path.join(__dirname, 'dashboard')), blockNgrokAccess, checkIPWhitelist);
app.use(express.static(path.join(__dirname, 'public')));
const reclamosRouter = require('./dashboard/reclamos');
app.use('/reclamos', blockNgrokAccess, checkIPWhitelist, reclamosRouter);

async function enviarNotificacion(areas) {
    const payload = JSON.stringify({
        title: 'Nuevo reclamo',
        body: `Hay un reclamo nuevo en estado PENDIENTE`
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

app.get('/vapidPublicKey', blockNgrokAccess, checkIPWhitelist, (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

app.post('/subscribe', blockNgrokAccess, checkIPWhitelist, express.json(), async (req, res) => {
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

const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
};

https.createServer(options, app).listen(3443, () => {
  console.log('Servidor HTTPS activo en puerto 3443');
});

app.listen(3000, () => {
  console.log('Servidor HTTP en puerto 3000');
});