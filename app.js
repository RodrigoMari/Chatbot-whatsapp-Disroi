const express = require('express');
const twilio = require('./twilio.js'); // reemplazá por la ruta real
const { ListItem } = require('twilio/lib/rest/content/v1/content.js');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const estados = {};
const app = express();

const main = "HX5cf55ca0144c76785d0a478483a3b49f"

const reclamo = "HX4f0a92516ed5057531bc858c1da18804"
const pedido = "HX25d7f54ba8b3d54d947652ffac9b8703"
const sobreNosotros = "HXfc73d64a5f842aded7fac0af5d082fff"

const noLlegó = "HX0cba42d4b6fdc98e57f029ad7df3b574"

let presentacion = 1

app.use(express.urlencoded({ extended: true }));

app.post('/webhook', async (req, res) => {
    let presentacion = 1
    const waId = req.body.WaId;
    const body = req.body.Body;
    const ListTitle = req.body.ListTitle;
    const title = req.body.ListTitle;


    if (presentacion === 1) {
        twilio.sendMessage(waId, "Bienvenido al asistente virtual de *Disroi*, mi nombre es *Rodri*\n\n" + "Para comenzar, le solicito que me brinde su *número de cliente* (sin ceros) o su *número de documento* para su correcta identificación\n\n");
        //busqueda por codigo de cliente
        if(body.length < 8){
            let codigoCeros = body
            for (let i = 0; i < 10 - body.length; i++) {
                codigoCeros = '0' + codigoCeros;
            }
            const cliente = await prisma.maestro_cliente.findFirst({where: {codigo: codigoCeros}});
            if (cliente){
                twilio.sendMessage(waId, `Hola ${cliente.nombre}`);
                presentacion = 0;
            }
        }
        //busqueda por dni
        else{
            const dniIngresado = req.body.Body.trim();
            const cliente = await prisma.$queryRaw`
                SELECT * FROM maestro_cliente
                WHERE dni = ${dniIngresado}
                OR SUBSTRING_INDEX(SUBSTRING_INDEX(cuit, '-', 2), '-', -1) = ${dniIngresado}
            `;
            if (cliente) {
                twilio.sendMessage(waId, `Hola ${cliente[0].nombre}`);
                presentacion = 0;
            }
        }

    }
    else{
        if (estados[waId]?.paso === 'guardar') {
            const datos = estados[waId];
            console.log("Observación recibida:", body);
            
            await prisma.reclamo.create({
            data: {
                cliente: "0000000021",
                tipo: datos.tipo,
                area: datos.area,
                cod_factura: datos.cod_factura,
                estado: false,
                observacion: body,
            }
            });
            delete estados[waId];
            return;
        }

        //main
        if (req.body.MessageType != 'interactive') {
            
            if(req.body.Body === 'lechuza') {
                twilio.sendMessage(waId, "piashins piashins");
            }
            else
                twilio.sendListPicker(waId, main);
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
                twilio.sendMessage(waId, "Por favor, escribe una observación sobre lo ocurrido. Cualquier información adicional es bienvenida.");
                estados[waId] = {
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
        switch (title) {
            case 'Volver al menú anterior':
                twilio.sendListPicker(waId, main);
                break;
        }
    }

});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});