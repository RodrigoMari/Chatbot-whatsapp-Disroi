const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  const reclamos = await prisma.reclamo.findMany({
    orderBy: { id: 'desc' },
    where: { estado: false },
    include: { maestro_21: true },
  });
  res.render('reclamos', { reclamos });
});

router.post('/resolver/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.reclamo.update({
    where: { id },
    data: { estado: true },
  });
  res.redirect('/reclamos');
});

module.exports = router;