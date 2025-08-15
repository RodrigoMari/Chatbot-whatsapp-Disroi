const express = require('express');
const twilio = require('./twilio.js'); // reemplazá por la ruta real
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
    //'192.168.110.179',  // depo Cesar
];

app.set('trust proxy', true);

//Chequear lista de IPs permitidas
const checkIPWhitelist = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    const cleanIP = clientIP.replace(/^::ffff:/, '');
    
    console.log('IP del cliente:', cleanIP); // Para debug
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

const main = "HX6870b1d969384339885c8fa36ad104b0"

const reclamo = "HX4f0a92516ed5057531bc858c1da18804"
const pedido = "HX25d7f54ba8b3d54d947652ffac9b8703"
const sobreNosotros = "HXfc73d64a5f842aded7fac0af5d082fff"

const noLlegó = "HX0cba42d4b6fdc98e57f029ad7df3b574";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function identificarUsuario(waId, body) {
    //busqueda por codigo de cliente
    if(body.length < 8){
        let codigoCeros = body
        for (let i = 0; i < 10 - body.length; i++) {
            codigoCeros = '0' + codigoCeros;
        }
        const cliente = await prisma.maestro_cliente.findFirst({where: {codigo: codigoCeros}});
        if (cliente){
            //await twilio.sendMessage(waId, `Hola ${cliente.nombre}`);
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
    
    //Mensaje de bienvenida
    if (!estados[waId]) {
        await twilio.sendMessage(waId,
            "Bienvenido al asistente virtual de *Disroi*, mi nombre es *Rodri*\n\n" +
            "Para comenzar, le solicito que me brinde su *código de cliente* (sin ceros) o su *número de documento* para su correcta identificación\n\n"
        );
        estados[waId] = { paso: 'esperando_identificacion' };
        return;
    }

    //Identificación del usuario
    if (estados[waId].paso === 'esperando_identificacion') {
        await identificarUsuario(waId, body);
        if (estados[waId].identificado) {
            estados[waId].paso = 'flujo';
        } else {
            twilio.sendMessage(waId, "No he podido identificarlo. Por favor, intente nuevamente. Asegúrese de ingresar solo su código de cliente (sin ceros) o número de documento");
        }
    }

    //Guardar reclamo
    if (estados[waId]?.paso === 'guardar') {
        const datos = estados[waId];
        try {
            await prisma.reclamo.create({
                data: {
                    cliente: datos.cliente_id,
                    tipo: datos.tipo,
                    reclamo_area: {
                        create: datos.area.map((area) => ({
                            area: area,
                        })),
                    },
                    cod_factura: datos.cod_factura,
                    estado: 'PENDIENTE',
                    observacion: body,
                }
            });

            enviarNotificacion(datos.area)

            delete estados[waId];
            return;
        } catch (error) {
            console.error('Error al guardar reclamo:', error);
            await twilio.sendMessage(waId, "Ocurrió un error al guardar su reclamo. Por favor, intente nuevamente.");
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
                //pedir num de facturacion y cod cliente
                twilio.sendListPicker(waId, noLlegó);
                break;
            case 'Me falta un producto':
                //pedir num de facturacion y cod cliente
                twilio.sendListPicker(waId, noLlegó);
                break;
            case 'Mi vendedor no me visitó':
                //avisarle al vendedor directamente que hay que visitarlo de manera urgente
                break;
            case 'Diferencia en CC':
                twilio.sendMessage(waId, "Por favor, escribe una observación sobre lo ocurrido (máximo 300 caracteres). Cualquier información adicional es bienvenida.");
                estados[waId] = {

                    ...estados[waId],
                    paso: 'guardar',
                    tipo: ListTitle,
                    cod_factura: 12345,
                    area: ['VENTAS', 'ADMINISTRACION'],
                };
                break;
            case 'Solicitud NDC':
                //pedir codigos de productos para hacer la nota de credito
                //avisarle al vendedor directamente que no se hizo la nota de crédito
                break;
            case 'Requiero atención':
                //debido a la alta demanda, no puedo asegurar que el supervisor se contacte contigo. Le recomiendo
                //comunicarse con el vendedor
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

const subscriptionsPath = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];

if (fs.existsSync(subscriptionsPath)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(subscriptionsPath, 'utf-8'));
    console.log('📦 Suscripciones cargadas:', subscriptions.length);
  } catch (err) {
    console.error('⚠️ Error leyendo subscriptions.json:', err);
    subscriptions = [];
  }
}

function enviarNotificacion(areas) {
    const payload = JSON.stringify({
        title: 'Nuevo reclamo',
        body: `Hay un reclamo nuevo en estado PENDIENTE`
    });
    
    subscriptions.forEach(sub => {
        areas.forEach(area => {
            if (area === sub.area) {
                webpush.sendNotification(sub, payload);
            }
        });
    });
}

function saveSubscriptions() {
  fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2));
}

app.post('/enviar-notificacion', async (req, res) => {
  const payload = JSON.stringify({
    title: 'Nuevo reclamo',
    body: 'Hay un nuevo reclamo pendiente de revisar'
  });

  console.log('Enviando notificaciones a', subscriptions.length, 'subscripciones');

  const fallidas = [];

  const enviar = subscriptions.map((sub, i) => {
    return webpush.sendNotification(sub, payload)
      .then(() => {
        console.log(`✅ Notificación enviada a subscription ${i}`);
      })
      .catch(err => {
        console.error(`❌ Error al enviar notificación a subscription ${i}:`, err.statusCode);

        // Si el error es 410 o 404, la subscription ya no sirve más
        if (err.statusCode === 410 || err.statusCode === 404) {
          fallidas.push(i);
        }
      });
  });
  

  try {
    await Promise.all(enviar);
    
    if (fallidas.length > 0) {
      // Eliminar suscripciones inválidas
      subscriptions = subscriptions.filter((_, i) => !fallidas.includes(i));
      saveSubscriptions();
      console.log(`🗑️ Eliminadas ${fallidas.length} suscripción(es) inválidas`);
    }

    console.log('📬 Todas las notificaciones enviadas (o descartadas)');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('💥 Error general en Promise.all:', err);
    res.status(500).json({ error: 'Error al enviar notificaciones' });
  }
});

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');

app.get('/check-subscription', (req, res) => {
  try {
    if (!fs.existsSync(SUBS_FILE)) return res.json({ exists: false });
    const subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    // Ejemplo: verificar IP o endpoint
    const exists = subscriptions.some(sub => sub.ip === req.ip); 
    res.json({ exists });
  } catch (err) {
    console.error(err);
    res.json({ exists: false });
  }
});



app.get('/vapidPublicKey', blockNgrokAccess, checkIPWhitelist, (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

app.post('/subscribe', blockNgrokAccess, checkIPWhitelist, express.json(), (req, res) => {
  const { subscription, area, nombre } = req.body;
  const clientIP = req.ip?.replace(/^::ffff:/, '') || null;

  const exists = subscriptions.some(sub => sub.endpoint === subscription.endpoint);

  if (!exists) {
    subscriptions.push({
        ...subscription,
        area,
        nombre,
        ip: clientIP
    });
    saveSubscriptions();
    console.log('✅ Nueva suscripción guardada');
  } else {
    console.log('ℹ️ Suscripción ya existente (no se duplica)');
  }

  console.log('Total suscripciones:', subscriptions.length);
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