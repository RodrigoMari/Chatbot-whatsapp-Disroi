const express = require('express');
const twilio = require('./twilio.js'); // reemplazá por la ruta real

const estados = {};
const app = express();

const main = "HX5cf55ca0144c76785d0a478483a3b49f"

const reclamo = "HX4f0a92516ed5057531bc858c1da18804"
const pedido = "HX25d7f54ba8b3d54d947652ffac9b8703"
const sobreNosotros = "HXfc73d64a5f842aded7fac0af5d082fff"

const noLlegó = "HX0cba42d4b6fdc98e57f029ad7df3b574"

app.use(express.urlencoded({ extended: true }));

app.post('/webhook', async (req, res) => {
    const waId = req.body.WaId;
    const body = req.body.Body;
    const ListTitle = req.body.ListTitle;
    const title = req.body.ListTitle;

    if (estados[waId] === 'esperando_observacion') {
        console.log("Observación recibida:", body);
        delete estados[waId];
        return;
    }

    //main
    if (req.body.MessageType != 'interactive') {
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
            twilio.sendListPicker(waId, noLlegó);
            break;
        case 'Diferencia en CC':
            twilio.sendMessage(waId, "Por favor, escribinos una observación sobre lo ocurrido.");
            estados[waId] = 'esperando_observacion';
            break;
    }

    //volver al menu principal
    switch (title) {
        case 'Volver al menú anterior':
            twilio.sendListPicker(waId, main);
            break;
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});