const express = require('express');
const twilio = require('./twilio.js'); // reemplazá por la ruta real
const { ListItem } = require('twilio/lib/rest/content/v1/content.js');
const { PrismaClient } = require('@prisma/client');
const Sync = require('twilio/lib/rest/Sync.js');
const { empty } = require('@prisma/client/runtime/library');

const prisma = new PrismaClient();
const estados = {};
const app = express();

const path = require('path');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard'));
app.use(express.static(path.join(__dirname, 'dashboard')));
const reclamosRouter = require('./dashboard/reclamos');
app.use('/reclamos', reclamosRouter);


const PORT = 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

const main = "HX6870b1d969384339885c8fa36ad104b0"

const reclamo = "HX4f0a92516ed5057531bc858c1da18804"
const pedido = "HX25d7f54ba8b3d54d947652ffac9b8703"
const sobreNosotros = "HXfc73d64a5f842aded7fac0af5d082fff"

const noLlegó = "HX0cba42d4b6fdc98e57f029ad7df3b574";

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
        console.log("Observación recibida:", body);

        try {
            await prisma.reclamo.create({
                data: {
                    cliente: datos.cliente_id,
                    tipo: datos.tipo,
                    area: datos.area,
                    cod_factura: datos.cod_factura,
                    estado: false,
                    observacion: body,
                }
            });

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
                    cod_factura: 'FAC12345',
                    area: 'Administracion'
                };
                break;
            case 'Solicitud NDC':
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
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});